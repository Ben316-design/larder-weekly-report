# Larder weekly performance report

A phone-first viewer for the single-sheet Larder weekly report. It retains the report's black, gold and coloured section treatment, while making every report area easy to browse from a menu.

## Weekly update workflow

1. Open the app and drop your `.xlsx` weekly report into **Weekly update** to check it immediately on your phone or computer. This update is saved in that browser only.
2. To update the version that everyone sees, open this GitHub repository and replace [`data/weekly-report.xlsx`](data/weekly-report.xlsx) with your new weekly export. Keep the same file name and commit the change.
3. Netlify deploys the commit automatically. When the public app is refreshed, it reads that new Excel file and displays its single current week.

The app accepts a workbook containing the report sheet only. It finds a sheet named **Generate Report** (or uses the first sheet) and shows the selected week from the report.

## Local preview

```powershell
npm start
```

Open `http://localhost:4173`. The local server allows the app to load the published Excel file. Opening `index.html` directly still shows the built-in report snapshot, and the drag-and-drop upload also works directly.

## Project files

- `data/weekly-report.xlsx` — the one published weekly spreadsheet. Replace this file on GitHub each week.
- `report-data.js` — a built-in fallback snapshot for direct local-file previews.
- `app.js` — the phone interface and Excel-file reader.
- `netlify.toml` — tells Netlify to publish this folder with no build command.
