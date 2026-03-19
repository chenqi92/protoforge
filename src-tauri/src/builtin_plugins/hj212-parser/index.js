/**
 * HJ 212-2017 环保数据传输协议解析器
 *
 * 报文格式: ##XXXX ST=xx;CN=xxxx;PW=xxx;MN=xxx;CP=&&...&&XXXX\r\n
 * - ##     固定头
 * - XXXX   数据段长度（4位）
 * - ST     系统编码
 * - CN     命令编码
 * - PW     密码
 * - MN     设备编号
 * - CP=&&...&& 数据区
 * - XXXX   CRC校验
 * - \r\n   结束符
 */
function parse(rawData) {
  try {
    var data = rawData.trim();

    // 验证基本格式
    if (data.indexOf("##") !== 0) {
      return {
        success: false,
        protocolName: "HJ212",
        summary: "",
        fields: [],
        error: "非 HJ212 报文：缺少 ## 头标识"
      };
    }

    var fields = [];
    var dataLen = data.substring(2, 6);
    fields.push({ key: "_dataLen", label: "数据段长度", value: dataLen, group: "报文头" });

    // 提取主数据段 (## 和末尾 CRC 之间)
    var body = data.substring(6);
    // 去掉尾部 CRC (最后4-6个字符可能是CRC+\r\n)
    var crcMatch = body.length > 4 ? body.substring(body.length - 4) : "";

    // 按分号分割键值对
    var pairs = body.split(";");
    var cpContent = "";
    var st = "";
    var cn = "";
    var mn = "";

    for (var i = 0; i < pairs.length; i++) {
      var pair = pairs[i];
      var eqIdx = pair.indexOf("=");
      if (eqIdx < 0) continue;

      var key = pair.substring(0, eqIdx).trim();
      var val = pair.substring(eqIdx + 1).trim();

      if (key === "ST") {
        st = val;
        var stNames = {
          "22": "地表水", "31": "大气环境", "32": "废气",
          "21": "废水", "51": "噪声", "91": "系统交互"
        };
        fields.push({ key: "ST", label: "系统编码", value: val + (stNames[val] ? " (" + stNames[val] + ")" : ""), group: "报文头" });
      } else if (key === "CN") {
        cn = val;
        var cnNames = {
          "2011": "实时数据上报", "2051": "分钟数据上报",
          "2061": "小时数据上报", "2031": "日数据上报",
          "9011": "心跳", "9014": "请求应答"
        };
        fields.push({ key: "CN", label: "命令编码", value: val + (cnNames[val] ? " (" + cnNames[val] + ")" : ""), group: "报文头" });
      } else if (key === "PW") {
        fields.push({ key: "PW", label: "密码", value: val, group: "报文头" });
      } else if (key === "MN") {
        mn = val;
        fields.push({ key: "MN", label: "设备编号", value: val, group: "报文头" });
      } else if (key === "Flag") {
        fields.push({ key: "Flag", label: "标志位", value: val, group: "报文头" });
      } else if (key === "CP") {
        cpContent = val;
      }
    }

    // 解析 CP 数据区: CP=&&DataTime=...;a01001-Rtd=...;...&&
    if (cpContent) {
      // 去除 && 标记
      var cp = cpContent.replace(/&&/g, "").trim();
      // 去掉尾部可能的 CRC
      if (cp.length > 4) {
        var lastFour = cp.substring(cp.length - 4);
        if (/^[0-9A-Fa-f]{4}$/.test(lastFour)) {
          cp = cp.substring(0, cp.length - 4);
        }
      }

      var cpPairs = cp.split(";");
      var pollutantNames = {
        "w01018": "COD", "w01019": "氨氮", "w01001": "pH",
        "w01010": "水温", "w01014": "电导率", "w01003": "浊度",
        "w21003": "氨氮(废水)", "w21011": "总磷", "w21001": "COD(废水)",
        "a01001": "温度", "a01002": "湿度", "a01006": "气压",
        "a01007": "风速", "a01008": "风向", "a34004": "PM2.5",
        "a34002": "PM10", "a21026": "SO2", "a21004": "NO2",
        "a05024": "O3", "a21005": "CO"
      };
      var suffixNames = {
        "Rtd": "实时值", "Avg": "平均值", "Min": "最小值",
        "Max": "最大值", "Flag": "标志", "Cou": "累计值"
      };

      for (var j = 0; j < cpPairs.length; j++) {
        var cpPair = cpPairs[j].trim();
        if (!cpPair) continue;
        var cpEq = cpPair.indexOf("=");
        if (cpEq < 0) continue;

        var cpKey = cpPair.substring(0, cpEq);
        var cpVal = cpPair.substring(cpEq + 1);

        if (cpKey === "DataTime") {
          fields.push({ key: "DataTime", label: "数据时间", value: cpVal, group: "数据区" });
          continue;
        }

        // Parse keys like "w01018-Rtd"
        var dashIdx = cpKey.indexOf("-");
        var pollCode = dashIdx > 0 ? cpKey.substring(0, dashIdx) : cpKey;
        var suffix = dashIdx > 0 ? cpKey.substring(dashIdx + 1) : "";

        var pollName = pollutantNames[pollCode] || pollCode;
        var suffName = suffixNames[suffix] || suffix;
        var label = pollName + (suffName ? " " + suffName : "");

        // Try to determine unit
        var unit = null;
        if (pollCode.indexOf("w01001") === 0) unit = "无量纲";
        else if (pollCode.indexOf("w01010") === 0 || pollCode.indexOf("a01001") === 0) unit = "°C";
        else if (pollCode.indexOf("a01002") === 0) unit = "%";
        else if (pollCode.indexOf("a01006") === 0) unit = "hPa";
        else if (pollCode.indexOf("a01007") === 0) unit = "m/s";
        else if (pollCode.indexOf("a01008") === 0) unit = "°";
        else if (pollCode.indexOf("a34") === 0 || pollCode.indexOf("a21") === 0 || pollCode.indexOf("a05") === 0) unit = "μg/m³";
        else if (pollCode.indexOf("w") === 0) unit = "mg/L";

        fields.push({
          key: cpKey,
          label: label,
          value: cpVal,
          unit: unit,
          group: "监测数据"
        });
      }
    }

    // Build summary
    var cnNames2 = {
      "2011": "实时数据", "2051": "分钟数据",
      "2061": "小时数据", "2031": "日数据",
      "9011": "心跳", "9014": "应答"
    };
    var summary = "HJ212 " + (cnNames2[cn] || "数据") + (mn ? " [" + mn + "]" : "");

    return {
      success: true,
      protocolName: "HJ212",
      summary: summary,
      fields: fields
    };
  } catch (e) {
    return {
      success: false,
      protocolName: "HJ212",
      summary: "",
      fields: [],
      error: "解析异常: " + e.toString()
    };
  }
}
