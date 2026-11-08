# 发布与更新指南

本项目采用「GitHub Releases 手动更新」模式：新版本 APK 传到 GitHub Releases，设备浏览器打开仓库页手动下载安装。应用内自动检查更新留作后续增强。

## 发布一个新版本

1. 改版本号：`app/native/app/build.gradle.kts` 里 `versionCode +1`、`versionName`
2. 构建并签名：
   ```
   cd app/native
   ./gradlew assembleDebug assembleRelease
   ```
3. 提交代码并打 tag：
   ```
   git add -A && git commit -m "v0.2.1: 更新说明"
   git tag v0.2.1 && git push origin main --tags
   ```
4. GitHub 仓库页 → Releases → Draft a new release → 选刚推的 tag → 上传两个 APK：
   - `MentalMath-<版本>-release.apk`（正式包）
   - `MentalMath-<版本>-debug.apk`（可选）
   - 填更新说明（改了什么），Publish

## 设备上更新（手动）

1. 设备浏览器打开 `https://github.com/<你>/<仓库名>/releases/latest`（永远指向最新版）
2. 下载 `MentalMath-<版本>-release.apk`
3. 系统提示「未知来源应用」时允许一次即可（之后同签名覆盖安装不再提示）
4. 安装完成，数据（题库/记录/珍珠）全部保留

> 覆盖安装的前提：同一把 keystore 签名。`local.properties`（含密码）和 keystore 文件务必备份，丢失后只能卸载重装（数据清空）。

## 国内网络建议

GitHub 在国内直连不稳定，几个替代方案按需选用：

- **镜像加速下载**：把 Release 附件链接加前缀 `https://mirror.ghproxy.com/` + 原链接（稳定性自行验证）
- **蒲公英（pgyer.com）备用通道**：每个版本同时传一份到蒲公英，README 里放两个下载链接（StudyOnTV 就是这么做的）
- **家庭内网直装**：手机浏览器直接访问 `http://<电脑IP>:8000/`（电脑上 `python3 -m http.server` 开在 APK 所在目录）——局域网内下载安装最快，不走外网

## 多设备（手机 + 平板）

每台设备是独立的题库和管理端，两个同步思路：

1. **Agent 推题推两次**（即时生效）：
   ```bash
   ITEMS='{"bankId":"agent-数学","bankName":"Agent · 数学","items":[...]}'
   for IP in <手机IP> <平板IP>; do
     curl -X POST http://$IP:8098/api/questions -H 'Content-Type: application/json' -d "$ITEMS"
   done
   ```
   设置（出题来源/默认年级/每轮题数）需在两台设备的管理端各配一次。

2. **URL 题库源**（一处维护、各自自动同步）：把题库 JSON 放进本仓库（或任意 http 地址），两台设备的管理端都添加这个 URL 源，打开 app 时自动拉取。练习记录与珍珠按设备各自累计（孩子在哪台刷就记哪台）。

## 安全清单（每次发布前过一遍）

- [ ] `local.properties`（含 keystore 密码）未被提交：`git status` 不应出现
- [ ] keystore（`~/.studyontv/studyontv-self.jks`）绝不上传仓库或 Release
- [ ] Release 里只放 APK，不放 keystore / 带密码的配置
- [ ] 题库 JSON 若放公开仓库，确认里面没有孩子姓名等隐私信息
