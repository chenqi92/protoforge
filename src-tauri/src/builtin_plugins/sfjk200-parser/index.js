/**
 * SFJK200 水文监测数据通信协议解析器
 *
 * 典型报文格式 (文本模式):
 * SOH STX ADDR FUNC DATA ETX CRC
 *
 * 常见数据格式示例:
 * 7E 7E 01 03 站号 功能码 数据... CRC 0D 0A
 *
 * 本解析器支持文本模式的简单键值对格式:
 * TT=站号;FC=功能码;ST=站类型;DT=数据时间;Key=Value;...
 *
 * 也支持标准帧格式的 hex 字符串解析。
 */
function parse(rawData) {
  try {
    var data = rawData.trim();
    var fields = [];

    // 尝试检测格式类型
    // 格式1: 键值对文本格式 (TT=xxx;FC=xxx;...)
    if (data.indexOf("TT=") >= 0 || data.indexOf("ST=") >= 0) {
      return parseTextFormat(data);
    }

    // 格式2: 十六进制帧格式 (7E 7E ...)
    if (/^[0-9A-Fa-f\s]+$/.test(data) && data.length > 10) {
      return parseHexFormat(data);
    }

    // 格式3: 尝试按通用分隔符解析
    if (data.indexOf(",") >= 0 || data.indexOf(";") >= 0) {
      return parseGenericFormat(data);
    }

    return {
      success: false,
      protocolName: "SFJK200",
      summary: "",
      fields: [],
      error: "无法识别报文格式，请确认是否为 SFJK200 协议数据"
    };
  } catch (e) {
    return {
      success: false,
      protocolName: "SFJK200",
      summary: "",
      fields: [],
      error: "解析异常: " + e.toString()
    };
  }
}

function parseTextFormat(data) {
  var fields = [];
  var pairs = data.split(";");
  var stationId = "";
  var funcCode = "";

  var keyLabels = {
    "TT": "遥测站地址",
    "FC": "功能码",
    "ST": "站类型",
    "DT": "数据时间",
    "WL": "水位",
    "WF": "流量",
    "WQ": "水量",
    "RF": "降雨量",
    "WT": "水温",
    "WS": "风速",
    "WD": "风向",
    "AT": "气温",
    "AH": "相对湿度",
    "AP": "气压",
    "BV": "电池电压",
    "SN": "序列号",
    "VER": "协议版本"
  };

  var keyUnits = {
    "WL": "m",
    "WF": "m³/s",
    "WQ": "m³",
    "RF": "mm",
    "WT": "°C",
    "WS": "m/s",
    "WD": "°",
    "AT": "°C",
    "AH": "%",
    "AP": "hPa",
    "BV": "V"
  };

  var funcNames = {
    "01": "实时数据上报",
    "02": "定时数据上报",
    "03": "加报数据",
    "04": "小时数据",
    "05": "人工置数",
    "10": "遥测站查询",
    "11": "参数设置",
    "F0": "心跳包"
  };

  var stNames = {
    "01": "雨量站", "02": "水位站", "03": "流量站",
    "04": "水质站", "05": "气象站", "06": "综合站"
  };

  for (var i = 0; i < pairs.length; i++) {
    var pair = pairs[i].trim();
    if (!pair) continue;
    var eqIdx = pair.indexOf("=");
    if (eqIdx < 0) continue;

    var key = pair.substring(0, eqIdx).trim();
    var val = pair.substring(eqIdx + 1).trim();

    if (key === "TT") stationId = val;
    if (key === "FC") funcCode = val;

    var label = keyLabels[key] || key;
    var displayVal = val;

    if (key === "FC" && funcNames[val]) {
      displayVal = val + " (" + funcNames[val] + ")";
    }
    if (key === "ST" && stNames[val]) {
      displayVal = val + " (" + stNames[val] + ")";
    }

    var group = "报文头";
    if (key === "WL" || key === "WF" || key === "WQ" || key === "RF" ||
        key === "WT" || key === "WS" || key === "WD" || key === "AT" ||
        key === "AH" || key === "AP") {
      group = "监测数据";
    } else if (key === "BV" || key === "SN") {
      group = "设备信息";
    }

    fields.push({
      key: key,
      label: label,
      value: displayVal,
      unit: keyUnits[key] || null,
      group: group
    });
  }

  var summary = "SFJK200 " + (funcNames[funcCode] || "数据") +
    (stationId ? " [站号: " + stationId + "]" : "");

  return {
    success: true,
    protocolName: "SFJK200",
    summary: summary,
    fields: fields
  };
}

function parseHexFormat(data) {
  var hex = data.replace(/\s+/g, "");
  var fields = [];

  // 基本帧头解析
  if (hex.length >= 4) {
    fields.push({ key: "frame_header", label: "帧头", value: hex.substring(0, 4), group: "帧结构" });
  }

  if (hex.length >= 6) {
    var addr = hex.substring(4, 6);
    fields.push({ key: "address", label: "地址", value: "0x" + addr + " (" + parseInt(addr, 16) + ")", group: "帧结构" });
  }

  if (hex.length >= 8) {
    var func = hex.substring(6, 8);
    fields.push({ key: "function", label: "功能码", value: "0x" + func, group: "帧结构" });
  }

  if (hex.length > 8) {
    var payload = hex.substring(8, hex.length - 4);
    fields.push({ key: "payload", label: "数据载荷", value: payload, group: "数据" });
    fields.push({ key: "payload_len", label: "载荷长度", value: (payload.length / 2).toString(), unit: "字节", group: "数据" });
  }

  if (hex.length >= 4) {
    var crc = hex.substring(hex.length - 4);
    fields.push({ key: "crc", label: "CRC校验", value: "0x" + crc, group: "帧结构" });
  }

  fields.push({ key: "total_len", label: "总长度", value: (hex.length / 2).toString(), unit: "字节", group: "帧结构" });

  return {
    success: true,
    protocolName: "SFJK200",
    summary: "SFJK200 二进制帧 (" + (hex.length / 2) + " 字节)",
    fields: fields,
    rawHex: hex
  };
}

function parseGenericFormat(data) {
  var fields = [];
  var sep = data.indexOf(";") >= 0 ? ";" : ",";
  var parts = data.split(sep);

  for (var i = 0; i < parts.length; i++) {
    var part = parts[i].trim();
    if (!part) continue;

    var eqIdx = part.indexOf("=");
    if (eqIdx >= 0) {
      fields.push({
        key: "field_" + i,
        label: part.substring(0, eqIdx).trim(),
        value: part.substring(eqIdx + 1).trim(),
        group: "数据"
      });
    } else {
      fields.push({
        key: "field_" + i,
        label: "字段 " + (i + 1),
        value: part,
        group: "数据"
      });
    }
  }

  return {
    success: true,
    protocolName: "SFJK200",
    summary: "SFJK200 数据 (" + fields.length + " 字段)",
    fields: fields
  };
}
