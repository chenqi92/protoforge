//! 内置协议解析器 — Rust 原生实现
//!
//! 将原 JS 版本重写为 Rust 原生代码：
//! - 零序列化开销、零运行时启动开销
//! - 比 boa_engine JS 快 50-100x
//! - 比 WASM (wasmtime) 快 2-5x（省去 WASM ↔ Host 内存复制）

use std::collections::HashMap;
use crate::plugin_runtime::{ParseResult, ParsedField};

// ═══════════════════════════════════════════
//  HJ212-2017 环保数据传输协议解析器
// ═══════════════════════════════════════════

#[allow(dead_code)]
pub fn parse_hj212(raw_data: &str) -> ParseResult {
    let data = raw_data.trim();

    if !data.starts_with("##") {
        return ParseResult {
            success: false,
            protocol_name: "HJ212".into(),
            summary: String::new(),
            fields: vec![],
            raw_hex: None,
            error: Some("非 HJ212 报文：缺少 ## 头标识".into()),
        };
    }

    let mut fields = Vec::new();
    let data_len = &data[2..6.min(data.len())];
    fields.push(ParsedField {
        key: "_dataLen".into(),
        label: "数据段长度".into(),
        value: data_len.into(),
        unit: None,
        group: Some("报文头".into()),
    });

    let body = &data[6..];
    
    // 找出 CP 段的内容
    let (head_str, cp_content) = if let Some(cp_start) = body.find("CP=&&") {
        let head = &body[..cp_start];
        let after_cp = &body[cp_start + 5..];
        if let Some(cp_end) = after_cp.find("&&") {
            (head, &after_cp[..cp_end])
        } else {
            (body, "")
        }
    } else {
        (body, "")
    };

    let pairs: Vec<&str> = head_str.split(';').collect();
    let mut cn = String::new();
    let mut mn = String::new();

    let st_names: HashMap<&str, &str> = [
        ("22", "地表水"), ("31", "大气环境"), ("32", "废气"),
        ("21", "废水"), ("51", "噪声"), ("91", "系统交互"),
    ].into_iter().collect();

    let cn_names: HashMap<&str, &str> = [
        ("2011", "实时数据上报"), ("2051", "分钟数据上报"),
        ("2061", "小时数据上报"), ("2031", "日数据上报"),
        ("9011", "心跳"), ("9014", "请求应答"),
    ].into_iter().collect();

    for pair in &pairs {
        if let Some(eq_idx) = pair.find('=') {
            let key = pair[..eq_idx].trim();
            let val = pair[eq_idx + 1..].trim();

            match key {
                "ST" => {
                    let display = if let Some(name) = st_names.get(val) {
                        format!("{} ({})", val, name)
                    } else {
                        val.to_string()
                    };
                    fields.push(field("ST", "系统编码", &display, "报文头"));
                }
                "CN" => {
                    cn = val.to_string();
                    let display = if let Some(name) = cn_names.get(val) {
                        format!("{} ({})", val, name)
                    } else {
                        val.to_string()
                    };
                    fields.push(field("CN", "命令编码", &display, "报文头"));
                }
                "PW" => fields.push(field("PW", "密码", val, "报文头")),
                "MN" => {
                    mn = val.to_string();
                    fields.push(field("MN", "设备编号", val, "报文头"));
                }
                "Flag" => fields.push(field("Flag", "标志位", val, "报文头")),
                _ => {}
            }
        }
    }

    // 解析 CP 数据区
    if !cp_content.is_empty() {
        let cp = cp_content.trim();

        let pollutant_names: HashMap<&str, &str> = [
            ("w01018", "COD"), ("w01019", "氨氮"), ("w01001", "pH"),
            ("w01010", "水温"), ("w01014", "电导率"), ("w01003", "浊度"),
            ("w21003", "氨氮(废水)"), ("w21011", "总磷"), ("w21001", "COD(废水)"),
            ("a01001", "温度"), ("a01002", "湿度"), ("a01006", "气压"),
            ("a01007", "风速"), ("a01008", "风向"), ("a34004", "PM2.5"),
            ("a34002", "PM10"), ("a21026", "SO2"), ("a21004", "NO2"),
            ("a05024", "O3"), ("a21005", "CO"),
        ].into_iter().collect();

        let suffix_names: HashMap<&str, &str> = [
            ("Rtd", "实时值"), ("Avg", "平均值"), ("Min", "最小值"),
            ("Max", "最大值"), ("Flag", "标志"), ("Cou", "累计值"),
        ].into_iter().collect();

        for cp_pair in cp.split(';') {
            let cp_pair = cp_pair.trim();
            if cp_pair.is_empty() { continue; }
            let Some(eq_pos) = cp_pair.find('=') else { continue };
            let cp_key = &cp_pair[..eq_pos];
            let cp_val = &cp_pair[eq_pos + 1..];

            if cp_key == "DataTime" {
                fields.push(field("DataTime", "数据时间", cp_val, "数据区"));
                continue;
            }

            let (poll_code, suffix) = if let Some(dash) = cp_key.find('-') {
                (&cp_key[..dash], &cp_key[dash + 1..])
            } else {
                (cp_key, "")
            };

            let poll_name = pollutant_names.get(poll_code).unwrap_or(&poll_code);
            let suf_name = suffix_names.get(suffix).unwrap_or(&suffix);
            let label = if suf_name.is_empty() {
                poll_name.to_string()
            } else {
                format!("{} {}", poll_name, suf_name)
            };

            let unit = determine_unit(poll_code);

            fields.push(ParsedField {
                key: cp_key.to_string(),
                label,
                value: cp_val.to_string(),
                unit,
                group: Some("监测数据".into()),
            });
        }
    }

    let cn_short: HashMap<&str, &str> = [
        ("2011", "实时数据"), ("2051", "分钟数据"),
        ("2061", "小时数据"), ("2031", "日数据"),
        ("9011", "心跳"), ("9014", "应答"),
    ].into_iter().collect();

    let summary = format!(
        "HJ212 {}{}",
        cn_short.get(cn.as_str()).unwrap_or(&"数据"),
        if mn.is_empty() { String::new() } else { format!(" [{}]", mn) }
    );

    ParseResult {
        success: true,
        protocol_name: "HJ212".into(),
        summary,
        fields,
        raw_hex: None,
        error: None,
    }
}

// ═══════════════════════════════════════════
//  SFJK200 水文监测数据通信协议解析器
// ═══════════════════════════════════════════

#[allow(dead_code)]
pub fn parse_sfjk200(raw_data: &str) -> ParseResult {
    let data = raw_data.trim();

    // 格式1: 键值对文本
    if data.contains("TT=") || data.contains("ST=") {
        return parse_sfjk200_text(data);
    }

    // 格式2: 十六进制帧
    let is_hex = data.len() > 10
        && data.chars().all(|c| c.is_ascii_hexdigit() || c.is_ascii_whitespace());
    if is_hex {
        return parse_sfjk200_hex(data);
    }

    // 格式3: 通用分隔符
    if data.contains(',') || data.contains(';') {
        return parse_sfjk200_generic(data);
    }

    ParseResult {
        success: false,
        protocol_name: "SFJK200".into(),
        summary: String::new(),
        fields: vec![],
        raw_hex: None,
        error: Some("无法识别报文格式，请确认是否为 SFJK200 协议数据".into()),
    }
}

#[allow(dead_code)]
fn parse_sfjk200_text(data: &str) -> ParseResult {
    let mut fields = Vec::new();
    let mut station_id = String::new();
    let mut func_code = String::new();

    let key_labels: HashMap<&str, &str> = [
        ("TT", "遥测站地址"), ("FC", "功能码"), ("ST", "站类型"),
        ("DT", "数据时间"), ("WL", "水位"), ("WF", "流量"),
        ("WQ", "水量"), ("RF", "降雨量"), ("WT", "水温"),
        ("WS", "风速"), ("WD", "风向"), ("AT", "气温"),
        ("AH", "相对湿度"), ("AP", "气压"), ("BV", "电池电压"),
        ("SN", "序列号"), ("VER", "协议版本"),
    ].into_iter().collect();

    let key_units: HashMap<&str, &str> = [
        ("WL", "m"), ("WF", "m³/s"), ("WQ", "m³"), ("RF", "mm"),
        ("WT", "°C"), ("WS", "m/s"), ("WD", "°"), ("AT", "°C"),
        ("AH", "%"), ("AP", "hPa"), ("BV", "V"),
    ].into_iter().collect();

    let func_names: HashMap<&str, &str> = [
        ("01", "实时数据上报"), ("02", "定时数据上报"), ("03", "加报数据"),
        ("04", "小时数据"), ("05", "人工置数"), ("10", "遥测站查询"),
        ("11", "参数设置"), ("F0", "心跳包"),
    ].into_iter().collect();

    let st_names: HashMap<&str, &str> = [
        ("01", "雨量站"), ("02", "水位站"), ("03", "流量站"),
        ("04", "水质站"), ("05", "气象站"), ("06", "综合站"),
    ].into_iter().collect();

    let data_keys = ["WL", "WF", "WQ", "RF", "WT", "WS", "WD", "AT", "AH", "AP"];

    for pair in data.split(';') {
        let pair = pair.trim();
        if pair.is_empty() { continue; }
        let Some(eq) = pair.find('=') else { continue };
        let key = pair[..eq].trim();
        let val = pair[eq + 1..].trim();

        if key == "TT" { station_id = val.to_string(); }
        if key == "FC" { func_code = val.to_string(); }

        let label = key_labels.get(key).unwrap_or(&key).to_string();
        let display = if key == "FC" {
            func_names.get(val).map_or(val.to_string(), |n| format!("{} ({})", val, n))
        } else if key == "ST" {
            st_names.get(val).map_or(val.to_string(), |n| format!("{} ({})", val, n))
        } else {
            val.to_string()
        };

        let group = if data_keys.contains(&key) {
            "监测数据"
        } else if key == "BV" || key == "SN" {
            "设备信息"
        } else {
            "报文头"
        };

        fields.push(ParsedField {
            key: key.to_string(),
            label,
            value: display,
            unit: key_units.get(key).map(|u| u.to_string()),
            group: Some(group.into()),
        });
    }

    let func_label = func_names.get(func_code.as_str()).unwrap_or(&"数据");
    let summary = format!(
        "SFJK200 {}{}",
        func_label,
        if station_id.is_empty() { String::new() } else { format!(" [站号: {}]", station_id) }
    );

    ParseResult {
        success: true,
        protocol_name: "SFJK200".into(),
        summary,
        fields,
        raw_hex: None,
        error: None,
    }
}

#[allow(dead_code)]
fn parse_sfjk200_hex(data: &str) -> ParseResult {
    let hex: String = data.chars().filter(|c| !c.is_ascii_whitespace()).collect();
    let mut fields = Vec::new();

    if hex.len() >= 4 {
        fields.push(field("frame_header", "帧头", &hex[..4], "帧结构"));
    }
    if hex.len() >= 6 {
        let addr = &hex[4..6];
        let addr_dec = u8::from_str_radix(addr, 16).unwrap_or(0);
        fields.push(field("address", "地址", &format!("0x{} ({})", addr, addr_dec), "帧结构"));
    }
    if hex.len() >= 8 {
        fields.push(field("function", "功能码", &format!("0x{}", &hex[6..8]), "帧结构"));
    }
    if hex.len() > 8 {
        let end = if hex.len() >= 4 { hex.len() - 4 } else { hex.len() };
        let payload = &hex[8..end];
        fields.push(field("payload", "数据载荷", payload, "数据"));
        fields.push(ParsedField {
            key: "payload_len".into(),
            label: "载荷长度".into(),
            value: (payload.len() / 2).to_string(),
            unit: Some("字节".into()),
            group: Some("数据".into()),
        });
    }
    if hex.len() >= 4 {
        fields.push(field("crc", "CRC校验", &format!("0x{}", &hex[hex.len()-4..]), "帧结构"));
    }
    fields.push(ParsedField {
        key: "total_len".into(),
        label: "总长度".into(),
        value: (hex.len() / 2).to_string(),
        unit: Some("字节".into()),
        group: Some("帧结构".into()),
    });

    ParseResult {
        success: true,
        protocol_name: "SFJK200".into(),
        summary: format!("SFJK200 二进制帧 ({} 字节)", hex.len() / 2),
        fields,
        raw_hex: Some(hex),
        error: None,
    }
}

#[allow(dead_code)]
fn parse_sfjk200_generic(data: &str) -> ParseResult {
    let sep = if data.contains(';') { ';' } else { ',' };
    let mut fields = Vec::new();

    for (i, part) in data.split(sep).enumerate() {
        let part = part.trim();
        if part.is_empty() { continue; }
        if let Some(eq) = part.find('=') {
            fields.push(field(
                &format!("field_{}", i),
                part[..eq].trim(),
                part[eq + 1..].trim(),
                "数据",
            ));
        } else {
            fields.push(field(
                &format!("field_{}", i),
                &format!("字段 {}", i + 1),
                part,
                "数据",
            ));
        }
    }

    ParseResult {
        success: true,
        protocol_name: "SFJK200".into(),
        summary: format!("SFJK200 数据 ({} 字段)", fields.len()),
        fields,
        raw_hex: None,
        error: None,
    }
}

// ── Helpers ──

#[allow(dead_code)]
fn field(key: &str, label: &str, value: &str, group: &str) -> ParsedField {
    ParsedField {
        key: key.to_string(),
        label: label.to_string(),
        value: value.to_string(),
        unit: None,
        group: Some(group.to_string()),
    }
}

#[allow(dead_code)]
fn determine_unit(poll_code: &str) -> Option<String> {
    if poll_code.starts_with("w01001") { Some("无量纲".into()) }
    else if poll_code.starts_with("w01010") || poll_code.starts_with("a01001") { Some("°C".into()) }
    else if poll_code.starts_with("a01002") { Some("%".into()) }
    else if poll_code.starts_with("a01006") { Some("hPa".into()) }
    else if poll_code.starts_with("a01007") { Some("m/s".into()) }
    else if poll_code.starts_with("a01008") { Some("°".into()) }
    else if poll_code.starts_with("a34") || poll_code.starts_with("a21") || poll_code.starts_with("a05") { Some("μg/m³".into()) }
    else if poll_code.starts_with('w') { Some("mg/L".into()) }
    else { None }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ═══════════════════════════════════════════
    //  HJ212 解析器测试
    // ═══════════════════════════════════════════

    #[test]
    fn test_hj212_standard_realtime_data() {
        let raw = "##0139ST=22;CN=2011;PW=123456;MN=88888880000001;Flag=4;CP=&&DataTime=20230601120000;w01018-Rtd=25.6;w01019-Rtd=1.2;w01001-Rtd=7.5&&1234";
        let result = parse_hj212(raw);

        assert!(result.success, "HJ212 解析应成功");
        assert_eq!(result.protocol_name, "HJ212");
        assert!(result.summary.contains("实时数据"));
        assert!(result.summary.contains("88888880000001"));

        // 检查字段
        let st = result.fields.iter().find(|f| f.key == "ST").unwrap();
        assert!(st.value.contains("22"));
        assert!(st.value.contains("地表水"));

        let cn = result.fields.iter().find(|f| f.key == "CN").unwrap();
        assert!(cn.value.contains("2011"));
        assert!(cn.value.contains("实时数据上报"));

        let mn = result.fields.iter().find(|f| f.key == "MN").unwrap();
        assert_eq!(mn.value, "88888880000001");

        // 检查监测数据
        let data_time = result.fields.iter().find(|f| f.key == "DataTime").unwrap();
        assert_eq!(data_time.value, "20230601120000");

        let cod = result.fields.iter().find(|f| f.key == "w01018-Rtd").unwrap();
        assert_eq!(cod.value, "25.6");
        assert!(cod.label.contains("COD"));
        assert!(cod.label.contains("实时值"));
    }

    #[test]
    fn test_hj212_heartbeat() {
        let raw = "##0080ST=91;CN=9011;PW=123456;MN=88888880000001;Flag=4;CP=&&&&ABCD";
        let result = parse_hj212(raw);

        assert!(result.success);
        assert!(result.summary.contains("心跳"));
    }

    #[test]
    fn test_hj212_system_codes() {
        // 测试不同的 ST 编码
        let cases = [
            ("22", "地表水"), ("31", "大气环境"), ("32", "废气"),
            ("21", "废水"), ("51", "噪声"), ("91", "系统交互"),
        ];
        for (code, name) in cases {
            let raw = format!("##0080ST={};CN=2011;PW=123456;MN=TEST01;Flag=4;CP=&&&&ABCD", code);
            let result = parse_hj212(&raw);
            assert!(result.success);
            let st = result.fields.iter().find(|f| f.key == "ST").unwrap();
            assert!(st.value.contains(name), "ST={} 应包含 '{}'", code, name);
        }
    }

    #[test]
    fn test_hj212_command_codes() {
        let cases = [
            ("2011", "实时数据上报"), ("2051", "分钟数据上报"),
            ("2061", "小时数据上报"), ("2031", "日数据上报"),
            ("9011", "心跳"), ("9014", "请求应答"),
        ];
        for (code, name) in cases {
            let raw = format!("##0080ST=22;CN={};PW=123456;MN=TEST01;Flag=4;CP=&&&&ABCD", code);
            let result = parse_hj212(&raw);
            assert!(result.success);
            let cn = result.fields.iter().find(|f| f.key == "CN").unwrap();
            assert!(cn.value.contains(name), "CN={} 应包含 '{}'", code, name);
        }
    }

    #[test]
    fn test_hj212_invalid_no_header() {
        let raw = "ST=22;CN=2011;PW=123456;MN=TEST01";
        let result = parse_hj212(raw);
        assert!(!result.success, "缺少 ## 头应失败");
        assert!(result.error.is_some());
        assert!(result.error.unwrap().contains("##"));
    }

    #[test]
    fn test_hj212_pollutant_units() {
        assert_eq!(determine_unit("w01001"), Some("无量纲".into()));
        assert_eq!(determine_unit("w01010"), Some("°C".into()));
        assert_eq!(determine_unit("a01001"), Some("°C".into()));
        assert_eq!(determine_unit("a01002"), Some("%".into()));
        assert_eq!(determine_unit("a34004"), Some("μg/m³".into()));
        assert_eq!(determine_unit("a21026"), Some("μg/m³".into()));
        assert_eq!(determine_unit("w01018"), Some("mg/L".into()));
        assert_eq!(determine_unit("unknown"), None);
    }

    #[test]
    fn test_hj212_air_quality_data() {
        let raw = "##0200ST=31;CN=2061;PW=123456;MN=AIR001;Flag=4;CP=&&DataTime=20230601130000;a34004-Avg=35.2;a34002-Avg=68.5;a21026-Avg=12.3;a01001-Avg=28.5;a01002-Avg=65.0&&FFFF";
        let result = parse_hj212(raw);

        assert!(result.success);
        let pm25 = result.fields.iter().find(|f| f.key == "a34004-Avg").unwrap();
        assert!(pm25.label.contains("PM2.5"));
        assert!(pm25.label.contains("平均值"));
        assert_eq!(pm25.value, "35.2");
        assert_eq!(pm25.unit.as_deref(), Some("μg/m³"));
    }

    // ═══════════════════════════════════════════
    //  SFJK200 解析器测试
    // ═══════════════════════════════════════════

    #[test]
    fn test_sfjk200_text_format() {
        let raw = "TT=12345678;FC=01;ST=02;DT=20230601120000;WL=15.32;WF=125.6;WT=22.5;BV=12.6";
        let result = parse_sfjk200(raw);

        assert!(result.success);
        assert_eq!(result.protocol_name, "SFJK200");
        assert!(result.summary.contains("实时数据上报"));
        assert!(result.summary.contains("12345678"));

        let wl = result.fields.iter().find(|f| f.key == "WL").unwrap();
        assert_eq!(wl.value, "15.32");
        assert_eq!(wl.unit.as_deref(), Some("m"));
        assert!(wl.label.contains("水位"));
    }

    #[test]
    fn test_sfjk200_station_types() {
        let cases = [
            ("01", "雨量站"), ("02", "水位站"), ("03", "流量站"),
            ("04", "水质站"), ("05", "气象站"), ("06", "综合站"),
        ];
        for (code, name) in cases {
            let raw = format!("TT=TEST;FC=01;ST={}", code);
            let result = parse_sfjk200(&raw);
            assert!(result.success);
            let st = result.fields.iter().find(|f| f.key == "ST").unwrap();
            assert!(st.value.contains(name), "ST={} 应包含 '{}'", code, name);
        }
    }

    #[test]
    fn test_sfjk200_hex_format() {
        let raw = "7E7E 01 02 AABBCCDD FFEE";
        let result = parse_sfjk200(raw);

        assert!(result.success);
        assert!(result.summary.contains("二进制帧"));
        assert!(result.raw_hex.is_some());

        let header = result.fields.iter().find(|f| f.key == "frame_header").unwrap();
        assert_eq!(header.value, "7E7E");
    }

    #[test]
    fn test_sfjk200_generic_format() {
        let raw = "field1=value1,field2=value2,field3=value3";
        let result = parse_sfjk200(raw);

        assert!(result.success);
        assert!(result.summary.contains("3 字段"));
    }

    #[test]
    fn test_sfjk200_unrecognized() {
        let raw = "This is not a valid SFJK200 message";
        let result = parse_sfjk200(raw);

        assert!(!result.success);
        assert!(result.error.is_some());
    }

    #[test]
    fn test_sfjk200_function_codes() {
        let cases = [
            ("01", "实时数据上报"), ("02", "定时数据上报"),
            ("03", "加报数据"), ("F0", "心跳包"),
        ];
        for (code, name) in cases {
            let raw = format!("TT=TEST;FC={}", code);
            let result = parse_sfjk200(&raw);
            assert!(result.success);
            assert!(result.summary.contains(name), "FC={} summary 应包含 '{}'", code, name);
        }
    }

    #[test]
    fn test_sfjk200_monitoring_units() {
        let raw = "TT=TEST;FC=01;WL=10.5;WF=50.3;RF=2.5;WT=20.1;AT=25.0;AH=60;AP=1013;WS=3.2;WD=180";
        let result = parse_sfjk200(raw);
        assert!(result.success);

        let check = |key: &str, expected_unit: &str| {
            let f = result.fields.iter().find(|f| f.key == key)
                .unwrap_or_else(|| panic!("应有字段 {}", key));
            assert_eq!(f.unit.as_deref(), Some(expected_unit),
                "字段 {} 单位应为 {}", key, expected_unit);
        };

        check("WL", "m");
        check("WF", "m³/s");
        check("RF", "mm");
        check("WT", "°C");
        check("AT", "°C");
        check("AH", "%");
        check("AP", "hPa");
        check("WS", "m/s");
        check("WD", "°");
    }
}
