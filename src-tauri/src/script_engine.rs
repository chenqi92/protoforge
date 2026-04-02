// ProtoForge JavaScript 脚本执行引擎
// 基于 Boa Engine，为前后置脚本提供 pm.* API

use boa_engine::{
    Context, JsValue, NativeFunction, Source,
    object::{JsObject, ObjectInitializer},
    property::{Attribute, PropertyKey},
};
use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

/// 前置脚本可读取/修改的请求上下文
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptRequestContext {
    pub method: String,
    pub url: String,
    pub headers: HashMap<String, String>,
    pub query_params: HashMap<String, String>,
    pub body: Option<String>,
}

/// 前置脚本产出的请求补丁
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptRequestPatch {
    pub headers: HashMap<String, String>,
    pub removed_headers: Vec<String>,
    pub query_params: HashMap<String, String>,
    pub removed_query_params: Vec<String>,
}

/// 脚本执行结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptResult {
    pub env_updates: HashMap<String, String>,
    pub folder_updates: HashMap<String, String>,
    pub collection_updates: HashMap<String, String>,
    pub global_updates: HashMap<String, String>,
    pub request_patch: Option<ScriptRequestPatch>,
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

fn empty_script_result() -> ScriptResult {
    ScriptResult {
        env_updates: HashMap::new(),
        folder_updates: HashMap::new(),
        collection_updates: HashMap::new(),
        global_updates: HashMap::new(),
        request_patch: None,
        test_results: vec![],
        logs: vec![],
        success: true,
        error: None,
    }
}

/// 执行前置脚本
pub fn run_pre_script(script: &str, env_vars: &HashMap<String, String>) -> ScriptResult {
    run_pre_script_with_scopes(script, env_vars, &HashMap::new(), &HashMap::new())
}

/// 执行前置脚本（兼容旧签名：environment + collection + globals）
pub fn run_pre_script_with_scopes(
    script: &str,
    env_vars: &HashMap<String, String>,
    collection_vars: &HashMap<String, String>,
    global_vars: &HashMap<String, String>,
) -> ScriptResult {
    run_pre_request_script_with_scopes(
        script,
        env_vars,
        &HashMap::new(),
        collection_vars,
        global_vars,
        None,
    )
}

/// 执行前置脚本（完整作用域 + 当前请求）
pub fn run_pre_request_script_with_scopes(
    script: &str,
    env_vars: &HashMap<String, String>,
    folder_vars: &HashMap<String, String>,
    collection_vars: &HashMap<String, String>,
    global_vars: &HashMap<String, String>,
    request: Option<&ScriptRequestContext>,
) -> ScriptResult {
    if script.trim().is_empty() {
        return empty_script_result();
    }

    run_script_internal(
        script,
        env_vars,
        folder_vars,
        collection_vars,
        global_vars,
        None,
        request,
    )
}

/// 执行后置脚本
#[allow(dead_code)]
pub fn run_post_script(
    script: &str,
    env_vars: &HashMap<String, String>,
    response: &ScriptResponse,
) -> ScriptResult {
    run_post_script_with_scopes(script, env_vars, &HashMap::new(), &HashMap::new(), response)
}

/// 执行后置脚本（兼容旧签名：environment + collection + globals）
pub fn run_post_script_with_scopes(
    script: &str,
    env_vars: &HashMap<String, String>,
    collection_vars: &HashMap<String, String>,
    global_vars: &HashMap<String, String>,
    response: &ScriptResponse,
) -> ScriptResult {
    run_post_script_with_all_scopes(
        script,
        env_vars,
        &HashMap::new(),
        collection_vars,
        global_vars,
        response,
    )
}

/// 执行后置脚本（完整作用域）
pub fn run_post_script_with_all_scopes(
    script: &str,
    env_vars: &HashMap<String, String>,
    folder_vars: &HashMap<String, String>,
    collection_vars: &HashMap<String, String>,
    global_vars: &HashMap<String, String>,
    response: &ScriptResponse,
) -> ScriptResult {
    if script.trim().is_empty() {
        return empty_script_result();
    }

    run_script_internal(
        script,
        env_vars,
        folder_vars,
        collection_vars,
        global_vars,
        Some(response),
        None,
    )
}

fn js_value_to_string(value: &JsValue, ctx: &mut Context) -> String {
    value
        .to_string(ctx)
        .ok()
        .map(|s| s.to_std_string_escaped())
        .unwrap_or_default()
}

fn get_arg_string(args: &[JsValue], index: usize, ctx: &mut Context) -> String {
    args.get(index)
        .map(|value| js_value_to_string(value, ctx))
        .unwrap_or_default()
}

fn get_object_string_property(obj: &JsObject, key: &str, ctx: &mut Context) -> Option<String> {
    let property = match key {
        "key" => PropertyKey::String(boa_engine::js_string!("key")),
        "value" => PropertyKey::String(boa_engine::js_string!("value")),
        _ => return None,
    };

    obj.get(property, ctx)
        .ok()
        .map(|value| js_value_to_string(&value, ctx))
        .filter(|value| !value.is_empty())
}

fn parse_key_value_args(args: &[JsValue], ctx: &mut Context) -> (String, String) {
    if let Some(first) = args.first() {
        if let Some(obj) = first.as_object() {
            let key = get_object_string_property(obj, "key", ctx).unwrap_or_default();
            let value = get_object_string_property(obj, "value", ctx).unwrap_or_default();
            if !key.is_empty() {
                return (key, value);
            }
        }
    }

    (get_arg_string(args, 0, ctx), get_arg_string(args, 1, ctx))
}

fn parse_key_arg(args: &[JsValue], ctx: &mut Context) -> String {
    if let Some(first) = args.first() {
        if let Some(obj) = first.as_object() {
            if let Some(key) = get_object_string_property(obj, "key", ctx) {
                return key;
            }
        }
    }

    get_arg_string(args, 0, ctx)
}

fn lookup_header_value(map: &HashMap<String, String>, key: &str) -> Option<String> {
    map.iter()
        .find(|(existing, _)| existing.eq_ignore_ascii_case(key))
        .map(|(_, value)| value.clone())
}

fn remove_header_value(map: &mut HashMap<String, String>, key: &str) {
    if let Some(existing_key) = map
        .keys()
        .find(|existing| existing.eq_ignore_ascii_case(key))
        .cloned()
    {
        map.remove(&existing_key);
    }
}

fn set_header_value(map: &mut HashMap<String, String>, key: String, value: String) {
    remove_header_value(map, &key);
    map.insert(key, value);
}

fn build_request_patch(
    original: &ScriptRequestContext,
    current_headers: &HashMap<String, String>,
    current_query: &HashMap<String, String>,
) -> Option<ScriptRequestPatch> {
    let mut header_updates = HashMap::new();
    for (key, value) in current_headers {
        let changed = lookup_header_value(&original.headers, key)
            .map(|existing| existing != *value)
            .unwrap_or(true);
        if changed {
            header_updates.insert(key.clone(), value.clone());
        }
    }

    let removed_headers = original
        .headers
        .keys()
        .filter(|key| lookup_header_value(current_headers, key).is_none())
        .cloned()
        .collect::<Vec<_>>();

    let mut query_updates = HashMap::new();
    for (key, value) in current_query {
        let changed = original
            .query_params
            .get(key)
            .map(|existing| existing != value)
            .unwrap_or(true);
        if changed {
            query_updates.insert(key.clone(), value.clone());
        }
    }

    let removed_query_params = original
        .query_params
        .keys()
        .filter(|key| !current_query.contains_key(*key))
        .cloned()
        .collect::<Vec<_>>();

    if header_updates.is_empty()
        && removed_headers.is_empty()
        && query_updates.is_empty()
        && removed_query_params.is_empty()
    {
        None
    } else {
        Some(ScriptRequestPatch {
            headers: header_updates,
            removed_headers,
            query_params: query_updates,
            removed_query_params,
        })
    }
}

fn run_script_internal(
    script: &str,
    env_vars: &HashMap<String, String>,
    folder_vars: &HashMap<String, String>,
    collection_vars: &HashMap<String, String>,
    global_vars: &HashMap<String, String>,
    response: Option<&ScriptResponse>,
    request: Option<&ScriptRequestContext>,
) -> ScriptResult {
    let env_updates: Rc<RefCell<HashMap<String, String>>> = Rc::new(RefCell::new(HashMap::new()));
    let folder_updates: Rc<RefCell<HashMap<String, String>>> =
        Rc::new(RefCell::new(HashMap::new()));
    let collection_updates: Rc<RefCell<HashMap<String, String>>> =
        Rc::new(RefCell::new(HashMap::new()));
    let global_updates: Rc<RefCell<HashMap<String, String>>> =
        Rc::new(RefCell::new(HashMap::new()));
    let test_results: Rc<RefCell<Vec<TestResult>>> = Rc::new(RefCell::new(Vec::new()));
    let logs: Rc<RefCell<Vec<String>>> = Rc::new(RefCell::new(Vec::new()));
    let request_headers_state: Rc<RefCell<HashMap<String, String>>> = Rc::new(RefCell::new(
        request.map(|req| req.headers.clone()).unwrap_or_default(),
    ));
    let request_query_state: Rc<RefCell<HashMap<String, String>>> = Rc::new(RefCell::new(
        request
            .map(|req| req.query_params.clone())
            .unwrap_or_default(),
    ));

    let mut context = Context::default();

    let logs_clone = logs.clone();
    let console_log = unsafe {
        NativeFunction::from_closure(move |_this, args, _ctx| {
            let msg = args
                .iter()
                .map(|arg| {
                    if let Some(s) = arg.as_string() {
                        s.to_std_string_escaped()
                    } else {
                        arg.display().to_string()
                    }
                })
                .collect::<Vec<_>>()
                .join(" ");
            logs_clone.borrow_mut().push(msg);
            Ok(JsValue::undefined())
        })
    };

    let env_updates_set = env_updates.clone();
    let pm_env_set = unsafe {
        NativeFunction::from_closure(move |_this, args, ctx| {
            let (key, value) = parse_key_value_args(args, ctx);
            if !key.is_empty() {
                env_updates_set.borrow_mut().insert(key, value);
            }
            Ok(JsValue::undefined())
        })
    };

    let env_vars_get = env_vars.clone();
    let env_updates_get = env_updates.clone();
    let pm_env_get = unsafe {
        NativeFunction::from_closure(move |_this, args, ctx| {
            let key = parse_key_arg(args, ctx);
            let value = env_updates_get
                .borrow()
                .get(&key)
                .cloned()
                .or_else(|| env_vars_get.get(&key).cloned());
            match value {
                Some(v) => Ok(JsValue::from(boa_engine::js_string!(v.as_str()))),
                None => Ok(JsValue::undefined()),
            }
        })
    };

    let folder_updates_set = folder_updates.clone();
    let pm_folder_set = unsafe {
        NativeFunction::from_closure(move |_this, args, ctx| {
            let (key, value) = parse_key_value_args(args, ctx);
            if !key.is_empty() {
                folder_updates_set.borrow_mut().insert(key, value);
            }
            Ok(JsValue::undefined())
        })
    };

    let folder_vars_get = folder_vars.clone();
    let folder_updates_get = folder_updates.clone();
    let pm_folder_get = unsafe {
        NativeFunction::from_closure(move |_this, args, ctx| {
            let key = parse_key_arg(args, ctx);
            let value = folder_updates_get
                .borrow()
                .get(&key)
                .cloned()
                .or_else(|| folder_vars_get.get(&key).cloned());
            match value {
                Some(v) => Ok(JsValue::from(boa_engine::js_string!(v.as_str()))),
                None => Ok(JsValue::undefined()),
            }
        })
    };

    let collection_updates_set = collection_updates.clone();
    let pm_collection_set = unsafe {
        NativeFunction::from_closure(move |_this, args, ctx| {
            let (key, value) = parse_key_value_args(args, ctx);
            if !key.is_empty() {
                collection_updates_set.borrow_mut().insert(key, value);
            }
            Ok(JsValue::undefined())
        })
    };

    let collection_vars_get = collection_vars.clone();
    let collection_updates_get = collection_updates.clone();
    let pm_collection_get = unsafe {
        NativeFunction::from_closure(move |_this, args, ctx| {
            let key = parse_key_arg(args, ctx);
            let value = collection_updates_get
                .borrow()
                .get(&key)
                .cloned()
                .or_else(|| collection_vars_get.get(&key).cloned());
            match value {
                Some(v) => Ok(JsValue::from(boa_engine::js_string!(v.as_str()))),
                None => Ok(JsValue::undefined()),
            }
        })
    };

    let global_updates_set = global_updates.clone();
    let pm_globals_set = unsafe {
        NativeFunction::from_closure(move |_this, args, ctx| {
            let (key, value) = parse_key_value_args(args, ctx);
            if !key.is_empty() {
                global_updates_set.borrow_mut().insert(key, value);
            }
            Ok(JsValue::undefined())
        })
    };

    let global_vars_get = global_vars.clone();
    let global_updates_get = global_updates.clone();
    let pm_globals_get = unsafe {
        NativeFunction::from_closure(move |_this, args, ctx| {
            let key = parse_key_arg(args, ctx);
            let value = global_updates_get
                .borrow()
                .get(&key)
                .cloned()
                .or_else(|| global_vars_get.get(&key).cloned());
            match value {
                Some(v) => Ok(JsValue::from(boa_engine::js_string!(v.as_str()))),
                None => Ok(JsValue::undefined()),
            }
        })
    };

    let resolved_env_vars = env_vars.clone();
    let resolved_folder_vars = folder_vars.clone();
    let resolved_collection_vars = collection_vars.clone();
    let resolved_global_vars = global_vars.clone();
    let resolved_env_updates = env_updates.clone();
    let resolved_folder_updates = folder_updates.clone();
    let resolved_collection_updates = collection_updates.clone();
    let resolved_global_updates = global_updates.clone();
    let pm_variables_get = unsafe {
        NativeFunction::from_closure(move |_this, args, ctx| {
            let key = parse_key_arg(args, ctx);
            let value = resolved_env_updates
                .borrow()
                .get(&key)
                .cloned()
                .or_else(|| resolved_env_vars.get(&key).cloned())
                .or_else(|| resolved_folder_updates.borrow().get(&key).cloned())
                .or_else(|| resolved_folder_vars.get(&key).cloned())
                .or_else(|| resolved_collection_updates.borrow().get(&key).cloned())
                .or_else(|| resolved_collection_vars.get(&key).cloned())
                .or_else(|| resolved_global_updates.borrow().get(&key).cloned())
                .or_else(|| resolved_global_vars.get(&key).cloned());
            match value {
                Some(v) => Ok(JsValue::from(boa_engine::js_string!(v.as_str()))),
                None => Ok(JsValue::undefined()),
            }
        })
    };

    let test_results_clone = test_results.clone();
    let pm_test = unsafe {
        NativeFunction::from_closure(move |_this, args, ctx| {
            let name = args
                .first()
                .map(|value| js_value_to_string(value, ctx))
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| "unnamed".to_string());
            let callback = args.get(1).cloned().unwrap_or(JsValue::undefined());
            if let Some(obj) = callback.as_object() {
                if obj.is_callable() {
                    match obj.call(&JsValue::undefined(), &[], ctx) {
                        Ok(_) => test_results_clone.borrow_mut().push(TestResult {
                            name,
                            passed: true,
                            error: None,
                        }),
                        Err(e) => test_results_clone.borrow_mut().push(TestResult {
                            name,
                            passed: false,
                            error: Some(e.to_string()),
                        }),
                    }
                }
            }
            Ok(JsValue::undefined())
        })
    };

    let console = ObjectInitializer::new(&mut context)
        .function(console_log, boa_engine::js_string!("log"), 0)
        .build();
    let _ = context.register_global_property(
        boa_engine::js_string!("console"),
        console,
        Attribute::all(),
    );

    let pm_env = ObjectInitializer::new(&mut context)
        .function(pm_env_set, boa_engine::js_string!("set"), 2)
        .function(pm_env_get, boa_engine::js_string!("get"), 1)
        .build();

    let pm_folder = ObjectInitializer::new(&mut context)
        .function(pm_folder_set, boa_engine::js_string!("set"), 2)
        .function(pm_folder_get, boa_engine::js_string!("get"), 1)
        .build();

    let pm_collection = ObjectInitializer::new(&mut context)
        .function(pm_collection_set, boa_engine::js_string!("set"), 2)
        .function(pm_collection_get, boa_engine::js_string!("get"), 1)
        .build();

    let pm_globals = ObjectInitializer::new(&mut context)
        .function(pm_globals_set, boa_engine::js_string!("set"), 2)
        .function(pm_globals_get, boa_engine::js_string!("get"), 1)
        .build();

    let pm_variables = ObjectInitializer::new(&mut context)
        .function(pm_variables_get, boa_engine::js_string!("get"), 1)
        .build();

    let pm_response = response.map(|resp| {
        let body_for_json = resp.body.clone();
        let pm_resp_json = unsafe {
            NativeFunction::from_closure(move |_this, _args, ctx| {
                let json_escaped =
                    serde_json::to_string(&body_for_json).unwrap_or_else(|_| "\"\"".to_string());
                let src = format!("JSON.parse({})", json_escaped);
                match ctx.eval(Source::from_bytes(&src)) {
                    Ok(val) => Ok(val),
                    Err(_) => Ok(JsValue::undefined()),
                }
            })
        };

        let headers_array = {
            let src_pairs: Vec<String> = resp
                .headers
                .iter()
                .map(|(k, v)| {
                    let k_escaped = serde_json::to_string(k).unwrap_or_else(|_| "\"\"".to_string());
                    let v_escaped = serde_json::to_string(v).unwrap_or_else(|_| "\"\"".to_string());
                    format!("{{\"key\":{},\"value\":{}}}", k_escaped, v_escaped)
                })
                .collect();
            let array_src = format!("[{}]", src_pairs.join(","));
            context
                .eval(Source::from_bytes(&array_src))
                .unwrap_or(JsValue::undefined())
        };

        ObjectInitializer::new(&mut context)
            .property(
                boa_engine::js_string!("status"),
                JsValue::from(resp.status as i32),
                Attribute::all(),
            )
            .property(
                boa_engine::js_string!("code"),
                JsValue::from(resp.status as i32),
                Attribute::all(),
            )
            .property(
                boa_engine::js_string!("statusText"),
                JsValue::from(boa_engine::js_string!(resp.status_text.as_str())),
                Attribute::all(),
            )
            .property(
                boa_engine::js_string!("body"),
                JsValue::from(boa_engine::js_string!(resp.body.as_str())),
                Attribute::all(),
            )
            .property(
                boa_engine::js_string!("durationMs"),
                JsValue::from(resp.duration_ms as i32),
                Attribute::all(),
            )
            .property(
                boa_engine::js_string!("responseTime"),
                JsValue::from(resp.duration_ms as i32),
                Attribute::all(),
            )
            .property(
                boa_engine::js_string!("headers"),
                headers_array,
                Attribute::all(),
            )
            .function(pm_resp_json, boa_engine::js_string!("json"), 0)
            .build()
    });

    let pm_request = request.map(|req| {
        let request_headers_get_state = request_headers_state.clone();
        let request_headers_get = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let key = parse_key_arg(args, ctx);
                let value = lookup_header_value(&request_headers_get_state.borrow(), &key);
                match value {
                    Some(v) => Ok(JsValue::from(boa_engine::js_string!(v.as_str()))),
                    None => Ok(JsValue::undefined()),
                }
            })
        };

        let request_headers_set_state = request_headers_state.clone();
        let request_headers_set = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let (key, value) = parse_key_value_args(args, ctx);
                if !key.is_empty() {
                    set_header_value(&mut request_headers_set_state.borrow_mut(), key, value);
                }
                Ok(JsValue::undefined())
            })
        };

        let request_headers_add_state = request_headers_state.clone();
        let request_headers_add = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let (key, value) = parse_key_value_args(args, ctx);
                if !key.is_empty() {
                    set_header_value(&mut request_headers_add_state.borrow_mut(), key, value);
                }
                Ok(JsValue::undefined())
            })
        };

        let request_headers_remove_state = request_headers_state.clone();
        let request_headers_remove = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let key = parse_key_arg(args, ctx);
                if !key.is_empty() {
                    remove_header_value(&mut request_headers_remove_state.borrow_mut(), &key);
                }
                Ok(JsValue::undefined())
            })
        };

        let request_query_get_state = request_query_state.clone();
        let request_query_get = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let key = parse_key_arg(args, ctx);
                let value = request_query_get_state.borrow().get(&key).cloned();
                match value {
                    Some(v) => Ok(JsValue::from(boa_engine::js_string!(v.as_str()))),
                    None => Ok(JsValue::undefined()),
                }
            })
        };

        let request_query_set_state = request_query_state.clone();
        let request_query_set = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let (key, value) = parse_key_value_args(args, ctx);
                if !key.is_empty() {
                    request_query_set_state.borrow_mut().insert(key, value);
                }
                Ok(JsValue::undefined())
            })
        };

        let request_query_add_state = request_query_state.clone();
        let request_query_add = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let (key, value) = parse_key_value_args(args, ctx);
                if !key.is_empty() {
                    request_query_add_state.borrow_mut().insert(key, value);
                }
                Ok(JsValue::undefined())
            })
        };

        let request_query_remove_state = request_query_state.clone();
        let request_query_remove = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let key = parse_key_arg(args, ctx);
                if !key.is_empty() {
                    request_query_remove_state.borrow_mut().remove(&key);
                }
                Ok(JsValue::undefined())
            })
        };

        let headers_obj = ObjectInitializer::new(&mut context)
            .function(request_headers_get, boa_engine::js_string!("get"), 1)
            .function(request_headers_set, boa_engine::js_string!("set"), 2)
            .function(request_headers_add, boa_engine::js_string!("add"), 2)
            .function(request_headers_remove, boa_engine::js_string!("remove"), 1)
            .build();

        let query_obj = ObjectInitializer::new(&mut context)
            .function(request_query_get, boa_engine::js_string!("get"), 1)
            .function(request_query_set, boa_engine::js_string!("set"), 2)
            .function(request_query_add, boa_engine::js_string!("add"), 2)
            .function(request_query_remove, boa_engine::js_string!("remove"), 1)
            .build();

        ObjectInitializer::new(&mut context)
            .property(
                boa_engine::js_string!("method"),
                JsValue::from(boa_engine::js_string!(req.method.as_str())),
                Attribute::all(),
            )
            .property(
                boa_engine::js_string!("url"),
                JsValue::from(boa_engine::js_string!(req.url.as_str())),
                Attribute::all(),
            )
            .property(
                boa_engine::js_string!("body"),
                req.body
                    .as_deref()
                    .map(|body| JsValue::from(boa_engine::js_string!(body)))
                    .unwrap_or_else(JsValue::undefined),
                Attribute::all(),
            )
            .property(
                boa_engine::js_string!("headers"),
                headers_obj,
                Attribute::all(),
            )
            .property(boa_engine::js_string!("query"), query_obj, Attribute::all())
            .build()
    });

    let mut pm_initializer = ObjectInitializer::new(&mut context);
    let pm_builder = pm_initializer
        .property(
            boa_engine::js_string!("environment"),
            pm_env,
            Attribute::all(),
        )
        .property(
            boa_engine::js_string!("folderVariables"),
            pm_folder,
            Attribute::all(),
        )
        .property(
            boa_engine::js_string!("collectionVariables"),
            pm_collection,
            Attribute::all(),
        )
        .property(
            boa_engine::js_string!("globals"),
            pm_globals,
            Attribute::all(),
        )
        .property(
            boa_engine::js_string!("variables"),
            pm_variables,
            Attribute::all(),
        )
        .function(pm_test, boa_engine::js_string!("test"), 2);

    let pm_builder = if let Some(resp_obj) = pm_response {
        pm_builder.property(
            boa_engine::js_string!("response"),
            resp_obj,
            Attribute::all(),
        )
    } else {
        pm_builder
    };

    let pm_builder = if let Some(request_obj) = pm_request {
        pm_builder.property(
            boa_engine::js_string!("request"),
            request_obj,
            Attribute::all(),
        )
    } else {
        pm_builder
    };

    let pm = pm_builder.build();
    let _ = context.register_global_property(boa_engine::js_string!("pm"), pm, Attribute::all());

    let result = context.eval(Source::from_bytes(script));
    let request_patch = request.and_then(|req| {
        build_request_patch(
            req,
            &request_headers_state.borrow(),
            &request_query_state.borrow(),
        )
    });

    ScriptResult {
        env_updates: env_updates.borrow().clone(),
        folder_updates: folder_updates.borrow().clone(),
        collection_updates: collection_updates.borrow().clone(),
        global_updates: global_updates.borrow().clone(),
        request_patch,
        test_results: test_results.borrow().clone(),
        logs: logs.borrow().clone(),
        success: result.is_ok(),
        error: result.err().map(|e| e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_console_log_capture() {
        let result = run_pre_script(
            r#"console.log("hello"); console.log("world", 42);"#,
            &HashMap::new(),
        );
        assert!(result.success);
        assert_eq!(result.logs.len(), 2);
        assert_eq!(result.logs[0], "hello");
        assert!(result.logs[1].contains("world"));
        assert!(result.logs[1].contains("42"));
    }

    #[test]
    fn test_pm_env_set() {
        let result = run_pre_script(r#"pm.environment.set("token", "abc123");"#, &HashMap::new());
        assert!(result.success);
        assert_eq!(result.env_updates.get("token"), Some(&"abc123".to_string()));
    }

    #[test]
    fn test_pm_folder_variables() {
        let mut folder = HashMap::new();
        folder.insert("tenantId".to_string(), "folder-1".to_string());

        let result = run_pre_request_script_with_scopes(
            r#"
            console.log(pm.folderVariables.get("tenantId"));
            pm.folderVariables.set("token", "folder-token");
            "#,
            &HashMap::new(),
            &folder,
            &HashMap::new(),
            &HashMap::new(),
            None,
        );

        assert!(result.success);
        assert_eq!(result.logs[0], "folder-1");
        assert_eq!(
            result.folder_updates.get("token"),
            Some(&"folder-token".to_string())
        );
    }

    #[test]
    fn test_post_script_response_json() {
        let response = ScriptResponse {
            status: 200,
            status_text: "OK".to_string(),
            body: r#"{"ok":true}"#.to_string(),
            headers: vec![("content-type".to_string(), "application/json".to_string())],
            duration_ms: 123,
        };

        let result = run_post_script(
            r#"
            const json = pm.response.json();
            console.log(json.ok);
            console.log(pm.response.code);
            console.log(pm.response.responseTime);
            "#,
            &HashMap::new(),
            &response,
        );

        assert!(result.success);
        assert_eq!(result.logs[0], "true");
        assert_eq!(result.logs[1], "200");
        assert_eq!(result.logs[2], "123");
    }

    #[test]
    fn test_pre_request_patch_headers_and_query() {
        let request = ScriptRequestContext {
            method: "GET".to_string(),
            url: "https://api.example.com/users".to_string(),
            headers: HashMap::from([("Accept".to_string(), "application/json".to_string())]),
            query_params: HashMap::from([("page".to_string(), "1".to_string())]),
            body: None,
        };

        let result = run_pre_request_script_with_scopes(
            r#"
            pm.request.headers.add({ key: "Authorization", value: "Bearer token-123" });
            pm.request.query.set("page", "2");
            "#,
            &HashMap::new(),
            &HashMap::new(),
            &HashMap::new(),
            &HashMap::new(),
            Some(&request),
        );

        assert!(result.success);
        let patch = result.request_patch.expect("should include request patch");
        assert_eq!(
            patch.headers.get("Authorization"),
            Some(&"Bearer token-123".to_string())
        );
        assert_eq!(patch.query_params.get("page"), Some(&"2".to_string()));
    }
}
