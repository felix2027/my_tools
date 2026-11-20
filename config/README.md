## 订阅转换远程配置:
> 修改自
> - https://github.com/ACL4SSR/ACL4SSR
> - https://github.com/blackmatrix7/ios_rule_script
``` sh
https://raw.githubusercontent.com/felix2027/my_tools/main/config/proxy_config.ini
```
``` sh
https://raw.githubusercontent.com/felix2027/my_tools/main/config/proxy_config_mini.ini

```
``` sh
https://raw.githubusercontent.com/felix2027/my_tools/main/config/proxy_config_next.ini
```
``` sh
https://raw.githubusercontent.com/felix2027/my_tools/main/config/proxy_config_quiet.ini
```
``` sh
https://raw.githubusercontent.com/felix2027/my_tools/main/config/proxy_config_relay.ini
```


jsdelivr 加速
``` sh
https://cdn.jsdelivr.net/gh/felix2027/my_tools@main/config/proxy_config.ini
```
``` sh
https://cdn.jsdelivr.net/gh/felix2027/my_tools@main/config/proxy_config_mini.ini
``` 
``` sh
https://cdn.jsdelivr.net/gh/felix2027/my_tools@main/config/proxy_config_quiet.ini
``` 
``` sh
https://cdn.jsdelivr.net/gh/felix2027/my_tools@main//config/proxy_config_next.ini
```
## 转换链接建议明确带上这些参数
关闭按名称额外排序、不跳过 TLS 证书验证、不附带订阅流量、到期等信息、使用现代 Clash 配置字段名称
``` sh
&sort=false&scv=false&append_info=false&new_name=true
``` 
## R76S 标准 INI

在支持目标节点协议的 Subconverter 服务中，选择完整 Clash 配置，把本分支 [proxy_config_r76s.ini](./proxy_config_r76s.ini) 的 Raw 地址填入「远程配置」或 `config=`。路由器订阅更新后，转换器按最新节点名称重新分组。订阅中有 VLESS、Reality 或 Hysteria2 时，先核对转换后的节点数量和协议。部分旧后端会直接省略不支持的节点。

| 在 Zashboard 中选择 | 实际行为 |
| --- | --- |
| `Proxies → Fallback`（默认） | 按 TW、SG、JP、US、HK、Other 顺序选择健康地区，各地区自动选择节点。 |
| `Proxies → TW` 等地区 | 固定地区，区内仍能自动换节点。该地区没有候选时使用 `REJECT`。 |
| `Proxies → Manual` | 首次选择时沿用 Fallback，也可以手动指定节点。 |
| `Auto` 或 `LoadBalance` | Auto 比较各地区当前出口，LoadBalance 在可用地区出口间分担连接。 |

地区组以 600 秒为探测周期，保留 150 毫秒延迟容差。总 Fallback 和港台 Fallback 以 150 秒为周期，只检查各自引用的地区出口。节点名同时命中多个地区时，按上述地区优先级只归入一组。部分节点只有国旗可用于识别地区，如需保留此信息，转换请求中省略 `emoji=false`。上层检查会再次经过地区当前选中的节点，实际探测次数还受核心的空闲策略和手动测速影响。

重载或长时间空闲后，地区组和上层组可能在不同时间完成首次检查。例如 TW 已找到可用节点，总 Fallback 可能仍使用 SG，直到下次检查 TW 出口。

三条置顶 IPv4 私网规则让已知私网目的地址交回系统路由。OpenWrt 负责 LAN/VLAN 和远端专网路由、国内业务的 WAN1 直连白名单、代理节点和探测的 WAN2 出口，以及 F50 月额度计量和断线阻断。实际接口与出口策略可在路由器上持久配置，订阅更新时无需修改生成的 YAML。

## 感谢/引用

[blackmatrix7](https://github.com/blackmatrix7/ios_rule_script/)

[ACL4SSR](https://github.com/ACL4SSR/ACL4SSR)
