# SubHub

一个功能强大的订阅转换平台，支持多种代理协议转换和配置模板管理。

## 功能特点

- 支持多种代理协议转换:
  - VMess
  - VLESS (支持 Reality)
  - Trojan
  - Shadowsocks
  - ShadowsocksR
  - Hysteria
  - Hysteria2
  - TUIC

- 支持多种输出格式:
  - 通用订阅链接
  - Clash 配置
  - SingBox 配置

## 使用说明

### 1. 输入类型
- **独立订阅链接**: 直接转换订阅链接，不会保存节点信息，无过期时间
- **多条节点**: 支持批量输入多个节点链接，会保存在 KV 中，24小时后过期

### 2. 链接说明
- **通用订阅链接**: `/base?url=` - 返回 base64 编码的原始节点信息
- **Clash 订阅**: `/clash?url=` - 返回 Clash 配置文件
- **SingBox 订阅**: `/singbox?url=` - 返回 SingBox 配置文件

所有链接都支持添加 `&template=` 参数指定配置模板

### 3. 配置模板说明

模板使用类 Clash 的语法格式，主要包含三个部分：

1. 规则集定义
ruleset=🎯 全球直连,https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/LocalAreaNetwork.list
ruleset=�� 广告拦截,https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/BanAD.list
ruleset=🚀 节点选择,[]MATCH

2. 节点分组配置
custom_proxy_group=🚀 节点选择select.
custom_proxy_group=♻️ 自动选择url-test.http://www.gstatic.com/generate_204300,,50
custom_proxy_group=🇭🇰 香港节点url-test(港|HK|Hong Kong)http://www.gstatic.com/generate_204300,,50


3. 节点筛选规则
- 正则匹配: `(港|HK|Hong Kong)`
- 反向匹配: `^(?!.*(美|US|States)).*$`
- 组合匹配: `^(?!.*(美|US|States)).*$(港|HK|Hong Kong)`

#### 节点分组类型
- `select`: 手动选择节点
- `url-test`: 自动测速选择，可配置测试间隔和延迟阈值

#### 内置规则
- `[]GEOIP,CN`: GeoIP 规则
- `[]MATCH`: 最终规则
- `[]DIRECT`: 直连规则
- `[]REJECT`: 拒绝规则

## 部署说明

1. 创建 Cloudflare Worker
2. 创建 KV 命名空间:
   - SUBLINK_KV: 用于存储节点信息（多条节点模式使用）
   - TEMPLATE_CONFIG: 用于存储配置模板
3. 绑定环境变量:
   - TEMPLATE_PASSWORD: 模板管理密码
   - DEFAULT_TEMPLATE_URL: 默认配置模板链接（可选，默认使用内置链接）

### 环境变量说明

1. **TEMPLATE_PASSWORD**
   - 必需
   - 用于模板管理页面的访问控制
   - 建议使用强密码

2. **DEFAULT_TEMPLATE_URL**
   - 可选
   - 默认值: `https://raw.githubusercontent.com/Troywww/singbox_conf/refs/heads/main/singbox_clash_conf.txt`
   - 用于设置默认的配置模板链接

3. **KV 命名空间**
   - SUBLINK_KV: 用于存储多条节点信息，24小时自动过期
   - TEMPLATE_CONFIG: 用于存储用户自定义的配置模板

### 部署方式

1. **通过 Cloudflare Dashboard**
   - 创建 Worker
   - 绑定 KV 命名空间
   - 设置环境变量
   - 部署代码

2. **通过 Cloudflare Pages**
   - 连接 GitHub 仓库
   - 配置构建设置
   - 绑定 KV 和环境变量
   - 自动部署

## 技术栈

- 前端:
  - React 17
  - TailwindCSS
  - 原生 JavaScript

- 后端:
  - Cloudflare Workers
  - KV 存储

## 项目结构
├── base.js # 基础转换功能
├── clash.js # Clash 配置生成
├── singbox.js # SingBox 配置生成
├── parser.js # 协议解析器
├── rules.js # 规则管理
├── tempmanager.js # 模板管理
├── worker.js # 主入口文件
├── htmlBuilder.js # 前端页面生成
└── style.js # 样式定义


## 注意事项

1. 节点信息安全：
   - 独立订阅模式不保存节点信息
   - 多条节点模式的信息会在 24 小时后自动删除
   - 建议敏感信息使用独立订阅模式

2. 配置模板使用：
   - 规则集 URL 必须是 HTTPS
   - 规则集内容需要符合 Clash 规则格式
   - 建议使用 CDN 托管规则文件
   - 模板修改需要密码验证

3. 性能优化：
   - 单个规则集大小建议不超过 1MB
   - 规则数量建议控制在合理范围内
   - 节点数量过多时建议使用分组筛选
  
## 免责声明

本项目仅供学习交流使用，请遵守当地法律法规。

