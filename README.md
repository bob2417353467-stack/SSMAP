# north-district-community-map

「北區，一齊行」：北區・古洞社區資源地圖。這是一個可部署到 GitHub Pages 的純靜態網站，資料日期為 **2026-10-29**。

## 部署到 GitHub Pages

1. 在 GitHub 建立新的 repository，將本資料夾內容放在 repository 根目錄。
2. 推送至 `main` 分支。
3. 在 repository 的 **Settings → Pages → Build and deployment**，將 Source 設為 **GitHub Actions**。
4. `.github/workflows/deploy-pages.yml` 會自動部署首頁。

```bash
git init
git add .
git commit -m "Initial community resource map"
git branch -M main
git remote add origin https://github.com/YOUR_ACCOUNT/north-district-community-map.git
git push -u origin main
```

## 本機預覽

直接在瀏覽器開啟 `index.html` 也可運作。若需要模擬 GitHub Pages 的 HTTP 環境，可在專案根目錄執行：

```bash
python -m http.server 8000
```

再開啟 `http://localhost:8000`。

街道底圖使用 `tile.openstreetmap.de` 的公開圖磚服務，顯示地圖時需要網絡連線；若底圖未能載入，地點列表、搜尋、篩選及詳情仍可繼續使用。

## 專案結構

```text
north-district-community-map/
├── .github/
│   └── workflows/
│       └── deploy-pages.yml
├── assets/
│   ├── css/
│   │   └── styles.css
│   ├── docs/
│   ├── images/
│   ├── js/
│   │   ├── app.js
│   │   └── data.js
│   ├── notes/
│   └── vendor/
├── data/
│   └── locations.json
├── .gitignore
├── .nojekyll
├── index.html
├── README.md
└── robots.txt
```

## 已完成功能

- 地圖固定在北區（上水、粉嶺及古洞）範圍；全景時停用縮小，拖曳及放大均受指定邊界限制
- 45 個已整理地點，分為「喘息空間」、「社區支援」及「衣食住行」；現有點集中於上水及粉嶺
- 43／45 個地點已有結構化開放時間；其餘 2 個只接受預約或轉介的綜合服務單位清楚說明以電話確認
- 真實街道地圖、標記聚合、放大縮小、拖曳及返回全區
- 「交通指引」涵蓋東鐵綫、區內及跨區巴士、機場／口岸接駁、綠色小巴、紅色小巴及的士，並連到上水站、上水巴士總站、粉嶺站轉車站及周邊地圖資源
- 圖像化需要入口、關鍵字搜尋、主題、地區、費用、詳細分類、服務對象及「按公開時間應開放」篩選
- 地圖第一級預覽及第二級完整詳情
- 電腦側邊詳情欄、手機底部詳情抽屜
- 電話、路線導航、官方網站、資料來源及固定版本聲明
- 七份義工手寫推薦及原稿放大；按原稿方向顯示並裁走多餘白邊
- 重要聯絡電話資訊圖
- 七張義工推薦相片畫廊（包括延伸探索），按原相比例顯示，可點擊放大及前後切換
- 頁尾 ISS 國際社標誌，以及「跨境及國際社會服務」的名稱、地址及電話
- 加權關鍵字搜尋及常用詞對照（例如「小朋友」對應「兒童」）
- 響應式版面、鍵盤焦點、ESC 關閉、減少動態效果支援

## 更新資料

網站執行資料位於 `assets/js/data.js`。修改後同步更新 `DATA_DATE`，並重新匯出 `data/locations.json`。每筆公開地點應保留名稱、分類、地址、座標、至少一個資料來源及資料日期。

地圖範圍定義於 `assets/js/app.js` 的 `MAP_SCOPE`。位於範圍外的座標會被排除，不會拖大北區及古洞地圖。古洞暫未有已核實的資源條目，網站不會為填補空位而虛構地點。

「現在應開放」只按結構化常規時間推算，不計即時活動、保養、公眾假期或惡劣天氣，因此不可視作即時營業保證。

上水公共交通路線及月台會隨營運安排調整；交通指引只作方向性整理，出發前應查閱運輸署、港鐵或相關營運商的最新公告。石湖墟賽馬會普通科門診診所已於 2024 年遷入北區社區健康中心，網站同步以「北區家庭醫學中心」及其新地址顯示。

## 主視覺生成

使用本地 MCP `wan_image`，模型固定為 `wan2.7-image-pro`。輸出檔案：

`assets/images/hero-community-map.png`

使用的核心提示詞：

> 為香港上水及粉嶺社區資源網站製作一張橫向主視覺插畫，溫暖、成熟、有社區生活感，不做幼稚卡通。以鳥瞰式抽象城市拼貼呈現東鐵線、屋邨公共空間、樹影、公園、街市棚頂、單車與巴士、圖書館與體育館輪廓；前景有長者與小孩一起看地圖，附近有義工背影。媒材像手工剪紙、孔版印刷、地圖標記與鉛筆線稿疊合，限定米白紙底、墨綠、陶土橘、淺藍灰和芥末黃；大量留白與紙張纖維質感。不要文字、字母、數字、品牌標誌、真實街道地圖複製、紫藍漸變、霓虹、3D gloss 或 emoji。

## 驗收

已用 Chromium 在 1440×1000 及 375×812 兩個視窗完成 69 項自動檢查，包括地圖邊界、縮放控制、45 個座標範圍、43 個結構化時間、交通指引及地圖關聯、上水及粉嶺巴士總站資料、替代圖磚、關鍵詞及同義詞搜尋、篩選、地圖標記、預覽、完整詳情、七份手寫推薦方向、七張義工推薦相片、重要電話、ISS 頁尾資料、手機地圖／列表切換、水平溢出及 JavaScript 錯誤檢查。

ISS 標誌取自香港國際社會服務社官方網站：

`https://www.isshk.org/img/isshk-logo.png`

## 備註

本網站不是即時名錄，也不取代政府或服務機構公告。資料未列出的欄位保持為「未有公開資料」，沒有把未知資料補成肯定答案。
