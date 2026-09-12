from pathlib import Path

app_path = Path('App.tsx')
text = app_path.read_text()

start = text.index("          {activeView === 'dashboard' && (")
end = text.index("\n\n          {activeView === 'registro' && (", start)
new_block = """          {activeView === 'dashboard' && (
            <div className=\"max-w-7xl mx-auto\">
              <Stats
                stats={stats}
                filterMode={statsFilterMode}
                setFilterMode={setStatsFilterMode}
                startDate={statsStartDate}
                setStartDate={setStatsStartDate}
                endDate={statsEndDate}
                setEndDate={setStatsEndDate}
                obraFilter={statsObraFilter}
                setObraFilter={setStatsObraFilter}
                savedObras={savedObras}
                onOpenReportModal={() => setIsReportModalOpen(true)}
                onExportObraSummary={handleExportObraSummary}
                onExportStatsSummaryPDF={handleExportStatsPDF}
              />
            </div>
          )}"""
text = text[:start] + new_block + text[end:]
app_path.write_text(text)

index_path = Path('index.tsx')
index = index_path.read_text()
index = index.replace("import './summary-layout.css';\n", '')
index_path.write_text(index)

print('Dashboard summary now mounts only Stats; legacy CSS workaround removed from bootstrap.')
