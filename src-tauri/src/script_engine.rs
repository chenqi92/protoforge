// ProtoForge JavaScript 脚本执行引擎
// 基于 Boa Engine，为前后置脚本提供 pm.* API

use boa_engine::{Context, JsValue, Source, property::Attribute};
use boa_engine::object::ObjectInitializer;
use boa_engine::NativeFunction;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::cell::RefCell;
use std::rc::Rc;

/// 脚本执行结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptResult {
    pub env_updates: HashMap<String, String>,
    pub test_results: Vec<TestResult>,
    pub logs: Vec<String>,
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestResult {
    pub name: String,
    pub passed: bool,
    pub error: Option<String>,
}

/// 响应信息，注入到后置脚本的 pm.response
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptResponse {
    pub status: u16,
    pub status_text: String,
    pub body: String,
    pub headers: Vec<(String, String)>,
    pub duration_ms: u64,
}

/// 执行前置脚本
pub fn run_pre_script(
    script: &str,
    env_vars: &HashMap<String, String>,
) -> ScriptResult {
    if script.trim().is_empty() {
        return ScriptResult {
            env_updates: HashMap::new(),
            test_results: vec![],
            logs: vec![],
            success: true,
            error: None,
        };
    }
    run_script_internal(script, env_vars, None)
}

/// 执行后置脚本
pub fn run_post_script(
    script: &str,
    env_vars: &HashMap<String, String>,
    response: &ScriptResponse,
) -> ScriptResult {
    if script.trim().is_empty() {
        return ScriptResult {
            env_updates: HashMap::new(),
            test_results: vec![],
            logs: vec![],
            success: true,
            error: None,
        };
    }
    run_script_internal(script, env_vars, Some(response))
}

fn run_script_internal(
    script: &str,
    env_vars: &HashMap<String, String>,
    response: Option<&ScriptResponse>,
) -> ScriptResult {
    let env_updates: Rc<RefCell<HashMap<String, String>>> = Rc::new(RefCell::new(HashMap::new()));
    let test_results: Rc<RefCell<Vec<TestResult>>> = Rc::new(RefCell::new(Vec::new()));
    let logs: Rc<RefCell<Vec<String>>> = Rc::new(RefCell::new(Vec::new()));

    let mut context = Context::default();

    // --- 创建 NativeFunction 实例（需要 unsafe） ---

    // console.log
    let logs_clone = logs.clone();
    // Safety: 闭包不跨线程使用，Boa Context 是单线程的
    let console_log = unsafe {
        NativeFunction::from_closure(move |_this, args, _ctx| {
            let msg = args.iter()
                .map(|a| a.display().to_string())
                .collect::<Vec<_>>()
                .join(" ");
            logs_clone.borrow_mut().push(msg);
            Ok(JsValue::undefined())
        })
    };

    // pm.environment.set
    let env_updates_set = env_updates.clone();
    let pm_env_set = unsafe {
        NativeFunction::from_closure(move |_this, args, ctx| {
            let key = args.get(0)
                .map(|v| v.to_string(ctx))
                .transpose()
                .unwrap_or(None)
                .map(|s| s.to_std_string_escaped())
                .unwrap_or_default();
            let value = args.get(1)
                .map(|v| v.to_string(ctx))
                .transpose()
                .unwrap_or(None)
                .map(|s| s.to_std_string_escaped())
                .unwrap_or_default();
            if !key.is_empty() {
                env_updates_set.borrow_mut().insert(key, value);
            }
            Ok(JsValue::undefined())
        })
    };

    // pm.environment.get
    let env_vars_get = env_vars.clone();
    let env_updates_get = env_updates.clone();
    let pm_env_get = unsafe {
        NativeFunction::from_closure(move |_this, args, ctx| {
            let key = args.get(0)
                .map(|v| v.to_string(ctx))
                .transpose()
                .unwrap_or(None)
                .map(|s| s.to_std_string_escaped())
                .unwrap_or_default();
            let value = env_updates_get.borrow().get(&key).cloned()
                .or_else(|| env_vars_get.get(&key).cloned());
            match value {
                Some(v) => Ok(JsValue::from(boa_engine::js_string!(v.as_str()))),
                None => Ok(JsValue::undefined()),
            }
        })
    };

    // pm.test
    let test_results_clone = test_results.clone();
    let pm_test = unsafe {
        NativeFunction::from_closure(move |_this, args, ctx| {
            let name = args.get(0)
                .map(|v| v.to_string(ctx))
                .transpose()
                .unwrap_or(None)
                .map(|s| s.to_std_string_escaped())
                .unwrap_or_else(|| "unnamed".to_string());
            let callback = args.get(1).cloned().unwrap_or(JsValue::undefined());
            if let Some(obj) = callback.as_object() {
                if obj.is_callable() {
                    match obj.call(&JsValue::undefined(), &[], ctx) {
                        Ok(_) => {
                            test_results_clone.borrow_mut().push(TestResult { name, passed: true, error: None });
                        }
                        Err(e) => {
                            test_results_clone.borrow_mut().push(TestResult {
                                name,
                                passed: false,
                                error: Some(e.to_string()),
                            });
                        }
                    }
                }
            }
            Ok(JsValue::undefined())
        })
    };

    // --- 构建对象并注册到全局作用域 ---

    // console 对象
    let console = ObjectInitializer::new(&mut context)
        .function(console_log, boa_engine::js_string!("log"), 0)
        .build();
    let _ = context.register_global_property(
        boa_engine::js_string!("console"),
        console,
        Attribute::all(),
    );

    // pm.environment 对象
    let pm_env = ObjectInitializer::new(&mut context)
        .function(pm_env_set, boa_engine::js_string!("set"), 2)
        .function(pm_env_get, boa_engine::js_string!("get"), 1)
        .build();

    // pm 对象
    let pm = if let Some(resp) = response {
        // 存一份 body 用于 json() 闭包
        let body_for_json = resp.body.clone();
        let pm_resp_json = unsafe {
            NativeFunction::from_closure(move |_this, _args, ctx| {
                // 使用 JSON.parse 代替 eval，避免恶意响应 body 注入执行任意 JS
                let json_escaped = serde_json::to_string(&body_for_json)
                    .unwrap_or_else(|_| "\"\"".to_string());
                let src = format!("JSON.parse({})", json_escaped);
                match ctx.eval(Source::from_bytes(&src)) {
                    Ok(val) => Ok(val),
                    Err(_) => Ok(JsValue::undefined()),
                }
            })
        };

        // response.headers — 使用 JS Array [{key, value}, ...] 保留同名 Header
        let headers_array = {
            let src_pairs: Vec<String> = resp.headers.iter().map(|(k, v)| {
                let k_escaped = serde_json::to_string(k).unwrap_or_else(|_| "\"\"".to_string());
                let v_escaped = serde_json::to_string(v).unwrap_or_else(|_| "\"\"".to_string());
                format!("{{\"key\":{},\"value\":{}}}", k_escaped, v_escaped)
            }).collect();
            let array_src = format!("[{}]", src_pairs.join(","));
            context.eval(Source::from_bytes(&array_src)).unwrap_or(JsValue::undefined())
        };

        // response 对象
        let resp_obj = ObjectInitializer::new(&mut context)
            .property(boa_engine::js_string!("status"), JsValue::from(resp.status as i32), Attribute::all())
            .property(boa_engine::js_string!("statusText"), JsValue::from(boa_engine::js_string!(resp.status_text.as_str())), Attribute::all())
            .property(boa_engine::js_string!("body"), JsValue::from(boa_engine::js_string!(resp.body.as_str())), Attribute::all())
            .property(boa_engine::js_string!("durationMs"), JsValue::from(resp.duration_ms as i32), Attribute::all())
            .property(boa_engine::js_string!("headers"), headers_array, Attribute::all())
            .function(pm_resp_json, boa_engine::js_string!("json"), 0)
            .build();

        // pm 对象 (含 response)
        ObjectInitializer::new(&mut context)
            .property(boa_engine::js_string!("environment"), pm_env, Attribute::all())
            .property(boa_engine::js_string!("response"), resp_obj, Attribute::all())
            .function(pm_test, boa_engine::js_string!("test"), 2)
            .build()
    } else {
        // pm 对象 (不含 response)
        ObjectInitializer::new(&mut context)
            .property(boa_engine::js_string!("environment"), pm_env, Attribute::all())
            .function(pm_test, boa_engine::js_string!("test"), 2)
            .build()
    };

    let _ = context.register_global_property(
        boa_engine::js_string!("pm"),
        pm,
        Attribute::all(),
    );

    // --- 执行脚本 ---
    let result = context.eval(Source::from_bytes(script));

    let env = Rc::try_unwrap(env_updates)
        .map(|r| r.into_inner())
        .unwrap_or_default();
    let tests = Rc::try_unwrap(test_results)
        .map(|r| r.into_inner())
        .unwrap_or_default();
    let l = Rc::try_unwrap(logs)
        .map(|r| r.into_inner())
        .unwrap_or_default();

    match result {
        Ok(_) => ScriptResult {
            env_updates: env,
            test_results: tests,
            logs: l,
            success: true,
            error: None,
        },
        Err(e) => ScriptResult {
            env_updates: env,
            test_results: tests,
            logs: l,
            success: false,
            error: Some(e.to_string()),
        },
    }
}
