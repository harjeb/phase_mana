# 本地卡图匹配检查

本轮核对配置中的 `F:/Solo Arcanum/card-images`，使用程序实际生成的图片 URL 与本地 Scryfall 数据库牌名、独立牌面名比对。检查和修复没有修改图库文件、下载图片或操作对局。

| 项目 | 结果 |
| --- | ---: |
| 图片文件 | 35,470（34,903 WebP、567 JPG） |
| 去重的牌名及牌面名 | 39,578 |
| 修复前匹配本地图 | 37,339 |
| 修复后匹配本地图 | 37,350 |
| 本轮发现的文件名遗漏 | 11 → 0 |
| 未找到对应文件的名称 | 2,228 |
| 全量图片解码失败 | 0 |

名称数量不是独立牌张数量：包含正背面组合名、单独牌面名、艺术牌和衍生物。未找到文件的条目仍使用原有网络回退；没有将它们算作本轮路径修复。文件名比对与完整解码也不代表逐图检查了牌名、语言和印次内容。

## 已恢复的本地图

| 请求名称 | 实际文件（相对图库根目录） |
| --- | --- |
| C.A.M.P. | `c/c_a_m_p.full.webp` |
| V.A.T.S. | `v/v_a_t_s.full.webp` |
| Borrowing 100,000 Arrows | `b/borrowing_100_000_arrows.full.webp` |
| Guan Yu's 1,000-Li March | `g/guan_yu_s_1_000_li_march.full.webp` |
| Welcome to . . . // Jurassic Park | `w/welcome_to.full.webp` |
| Welcome to . . . | `w/welcome_to.full.webp` |
| I'm a Doctor, Not a . . . | `i/i_m_a_doctor_not_a.full.webp` |
| Human—Time Lord Meta-Crisis | `h/human_time_lord_meta_crisis.full.webp` |
| Monster Mash-Up | `m/monster_mashup.full.webp` |
| M.O.D.O.K. // M.O.D.O.K. | `m/m_o_d_o_k.full.webp` |
| M.O.D.O.K., Evil Intellect // M.O.D.O.K., Evil Intellect | `m/m_o_d_o_k_evil_intellect.full.webp` |

`localCardArt.ts` 保留原先候选路径及 CDN 回退，补充图片包使用的标点分隔、连续/结尾下划线、连字号和 Unicode 拼写候选。旧的本地 URL 会补充新候选且不重复添加。运行时不进行模糊搜索。

这 11 个请求已通过实际本地 HTTP 图片接口验证：均返回 200，响应 SHA-256 与目标图库文件相同。

## 同时修复的显示入口

- 轮抽/限制赛在缺少 Scryfall 元数据时仍先请求本地图，不再直接显示占位牌。
- 轮抽的双面牌保存独立背面图片信息；某一面缺少图片 URL 时按该面的名字查找，避免误用另一面图片。
- 编辑器替换候选中的旧 CDN 缩略图、未自定义的衍生物缩略图接入本地优先路径。自定义衍生物图片保留选择结果。
- 开发服务器和原生网关按名字请求网络回退时，会优先选择名字匹配的背面；整张共享扫描图与默认正面行为保持一致。

## 验证与复查

33 项相关 UI/数据测试、TypeScript 检查、1 项模拟网络的开发服务器测试通过。Rust 网关选面逻辑在隔离测试中通过；完整服务测试被既有的 `server/src/main.rs:77` 调用缺失的 `CardDatabase::export_json` 阻断。

```sh
node tools/audit-local-card-images.mjs tools/local-card-images-audit-after.json
node tools/audit-local-card-images.mjs tools/local-card-images-audit-after.json --verify-from tools/local-card-images-audit-before.json
python tools/check-local-card-image-integrity.py
```

HTTP 验证默认连接 `http://127.0.0.1:1420`，可用 `AUDIT_HTTP_BASE` 指定地址。解码检查需要 Pillow。完整匹配结果保存在 `tools/local-card-images-audit-before.json`、`tools/local-card-images-audit-after.json`，解码结果在 `tools/local-card-images-integrity.json`。
