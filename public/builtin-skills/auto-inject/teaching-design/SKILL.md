---
name: teaching-design
description: 製作教材時自動使用：簡報、測驗、試卷、工作紙、插圖、教案、評分準則及通告等行政文件。先以可編輯的介面列出計劃，老師確認後才製作檔案。
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - AskUserQuestion
metadata:
  trigger: 老師要求製作或修改簡報、測驗、試卷、工作紙、插圖、教案、評分準則、通告或其他教學及行政文件
  audience: 香港中學中文科老師（繁體中文、粵語授課）
  revision: '2026-10-21'
---

# 教學設計流程

## 適用情況

老師要你**製作**教材或文件時使用：簡報、測驗、試卷、工作紙、插圖、教案、評分準則、通告及家長信。只是問問題（例如「呢句用咗咩修辭？」）就直接用文字回答，不要用這個流程，也不要加介面。

## 共通流程

1. **只問缺少的資料。** 年級、課文、課時、學習重點，老師已經講了的不要再問。可以合理推斷的就先推斷，放進計劃讓老師改。
2. **先出計劃。** 如果對話支援 OpenUI（訊息有提到 `openui/1`），用可編輯的 OpenUI 介面列出計劃，並加一個「確認並製作」按鈕（`@ToAssistant`）。計劃本身就是內容，前後文字最多一兩句。
3. **老師確認後才製作檔案。** 老師說「直接做」或「唔使問」就跳過計劃。
4. **製作檔案：**
   - 簡報（.pptx）：用 `officecli-pptx` 或 `morph-ppt`
   - 測驗、試卷、工作紙（.docx）：用 `officecli-docx`；需要填寫欄位的表格用 `officecli-word-form`
   - 插圖：用內置的圖像生成
5. **交付。** 每個檔案用一張 `FileCard` 顯示，路徑用工作區內的相對路徑。答案及評分參考另存一個檔案。
6. **修改。** 老師要求修改（「改深啲」「第三張改短啲」）時，只改需要改的部分，完成後再顯示新的 `FileCard`。

介面上所有文字用香港繁體中文。不要加只是重複文字內容的卡片或提示框。

回覆老師時：

- **不要提及技能名稱、檔案路徑或內部工具**（例如「我會用 teaching-design／humanizer-zh」或連結到 SKILL.md）。老師只需要看到結果。
- **出計劃時，文字最多兩句**，說明下一步即可。學習目標、提問、建議等內容放進介面（例如 `CardHeader` 副題、`SlideOutline` 的重點及講者備註、`TextContent`），不要在介面外再寫一大段。
- **同一內容只出現一次**：已放進介面的內容，不要在文字中重複；已在文字中寫出的表格或草稿，不要再放進介面。

## 簡報

計劃用 `SlideOutline`：每張投影片有標題、重點、建議圖像及講者備註。老師可以修改、調動次序、刪除或新增。

```openui
root = Stack([Card([header, outline]), deck])
header = CardHeader("《背影》簡報大綱", "中三 · 兩教節 · 共 6 張")
outline = SlideOutline("outline", [{title: "引入：你記得父母的背影嗎？", points: ["相片分享", "提問：背影代表甚麼？"], visual: "車站月台舊相片"}, {title: "作者及寫作背景", points: ["朱自清生平", "家道中落與父子關係"]}, {title: "四次寫背影", points: ["首段點題", "望父買橘", "父子分別", "結尾淚光中的背影"], visual: "父親攀爬月台的插圖"}, {title: "細節描寫", points: ["動作描寫：攀、縮、傾", "作者的情感變化"]}, {title: "討論", points: ["你會怎樣描寫家人的背影？"]}, {title: "總結及家課", points: ["一百字短文：家人的一個動作"]}])
deck = Form("deck", Buttons([Button("確認並製作", @ToAssistant("大綱已確認，請製作簡報"), "primary")]), [FormControl("簡報風格", Select("style", [SelectItem("simple", "簡潔清晰"), SelectItem("warm", "溫暖插圖")]))])
```

## 測驗及試卷

計劃用 `EditableTable` 列出藍圖：部分、題型、分數、能力層次。總分要跟老師要求的一致（例如 30 分）。答案及評分參考另存檔案。

```openui
root = Stack([Card([header, blueprint]), confirm])
header = CardHeader("《出師表》閱讀測驗藍圖", "中四 · 共 30 分 · 40 分鐘")
blueprint = EditableTable("blueprint", [{type: "text", key: "part", header: "部分"}, {type: "select", key: "kind", header: "題型", options: [{value: "mc", label: "選擇題"}, {value: "short", label: "短答"}, {value: "long", label: "長答"}]}, {type: "number", key: "marks", header: "分數"}, {type: "select", key: "level", header: "能力層次", options: [{value: "memory", label: "記憶"}, {value: "understand", label: "理解"}, {value: "analyse", label: "分析"}, {value: "evaluate", label: "評鑑"}]}], [{id: "1", values: ["字詞解釋", "short", 6, "memory"]}, {id: "2", values: ["語譯", "short", 6, "understand"]}, {id: "3", values: ["內容理解", "mc", 8, "understand"]}, {id: "4", values: ["寫作手法", "short", 4, "analyse"]}, {id: "5", values: ["評論諸葛亮的忠誠", "long", 6, "evaluate"]}])
confirm = Buttons([Button("確認並製作", @ToAssistant("藍圖已確認，請製作試卷及答案"), "primary")])
```

出題原則：

- 文言文篇章優先用指定文言經典精選的篇章，引文要準確，標明出處。
- 題型及能力層次參考 DSE 卷一閱讀能力：記憶、理解、分析、評鑑，由淺入深排列。
- 每題寫明分數；長答題附評分準則（分層描述，例如 上品／中品／下品）。

## 插圖

計劃用 `OptionCards` 讓老師選風格，再用 `TextArea` 讓老師補充畫面重點。

```openui
root = Stack([Card([header, form])])
header = CardHeader("《岳陽樓記》插圖", "請選擇風格及畫面重點")
form = Form("illustration", Buttons([Button("確認並生成", @ToAssistant("風格已確認，請生成插圖"), "primary")]), [FormControl("風格", OptionCards("style", "single", [OptionCard("ink", "水墨", "留白、淡墨山水"), OptionCard("comic", "漫畫", "線條清晰，適合初中"), OptionCard("real", "寫實", "樓閣及湖面細節")])), FormControl("畫面重點", TextArea("focus", "例如：洞庭湖遠景、陰晴兩種景象對比", 3))])
```

插圖不要加入文字；需要標題就放在簡報或工作紙上。

## 工作紙及評分準則

- 先用 `Steps` 或 `Tabs` 列出工作紙的部分（例如 審題、構思、段落安排、自評），老師確認後才製作 .docx。
- 評分準則用 `Table` 顯示（準則 × 等級），並同時放進檔案。

## 行政文件

通告、家長信、會議紀錄等直接用 Markdown 草擬，未知資料用【待填】標示。只有缺少日期、時間、費用、回條項目等必要資料時，才另加一個 `Form` 收集這些資料；草稿本身不要放進介面，也不要在文字和介面中各寫一次。

## 交付檔案

```openui
root = Stack([FileCard("簡報/背影-中三.pptx", "《背影》簡報", "6 張 · 兩教節"), FileCard("簡報/背影-講者備註.docx", "講者備註", "每張投影片的提問及答案")])
```

## 中文科重點

- 分清文言文及白話文的處理：文言文要有字詞解釋及語譯，白話文著重內容、手法及情感。
- 指定文言經典精選的篇章，引文以通行課本版本為準。
- 用語符合香港中學中文科慣用說法（例如「語譯」「修辭手法」「段落大意」）。

## 沒有 OpenUI 時

如果訊息沒有提到 `openui/1`，用 Markdown 列出同樣的計劃及問題（例如表格或編號清單），請老師回覆確認。
