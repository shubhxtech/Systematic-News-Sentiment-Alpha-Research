import { useMemo } from 'react';
import { useStore } from '../lib/store';
import { SECTORS } from '../lib/upstoxApi';

export default function SectorHeatmap() {
  const { screenerData } = useStore();
  const data = Object.values(screenerData);

  const sectorData = useMemo(() => {
    const res = {};
    SECTORS.forEach(s => res[s] = { count: 0, stocks: [], totalChg: 0, totalScore: 0 });
    
    data.forEach(d => {
      if (res[d.sector]) {
        res[d.sector].count++;
        res[d.sector].stocks.push(d);
        res[d.sector].totalChg += (d.changePct || 0);
        res[d.sector].totalScore += (d.signalScore || 0);
      }
    });

    // Calculate averages and sort by count to show biggest sectors first
    return Object.keys(res)
      .map(s => ({
        name: s,
        count: res[s].count,
        stocks: res[s].stocks.sort((a,b) => (b.changePct||0) - (a.changePct||0)),
        avgChg: res[s].count ? res[s].totalChg / res[s].count : 0,
        avgScore: res[s].count ? res[s].totalScore / res[s].count : 0,
      }))
      .filter(s => s.count > 0)
      .sort((a, b) => b.count - a.count);
  }, [data]);

  if (!data.length) {
    return <div className="flex items-center justify-center h-full text-slate-500">Loading heatmap data...</div>;
  }

  return (
    <div className="p-6 h-full overflow-auto bg-[#060b12]">
      <h2 className="text-xl font-bold text-white mb-6">Sector Heatmap</h2>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {sectorData.map(sector => (
          <div key={sector.name} className="card overflow-hidden flex flex-col">
            {/* Sector Header */}
            <div className={`p-4 border-b border-white/[0.05] flex justify-between items-center ${
              sector.avgChg > 1 ? 'bg-emerald-500/10' : 
              sector.avgChg < -1 ? 'bg-red-500/10' : 'bg-slate-800/30'
            }`}>
              <div>
                <h3 className="font-bold text-white">{sector.name}</h3>
                <div className="text-xs text-slate-400 mt-1">{sector.count} stocks • Avg Score: {sector.avgScore.toFixed(0)}</div>
              </div>
              <div className={`text-lg font-mono font-bold ${sector.avgChg >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {sector.avgChg > 0 ? '+' : ''}{sector.avgChg.toFixed(2)}%
              </div>
            </div>

            {/* Stocks Grid */}
            <div className="p-2 grid grid-cols-2 gap-2 flex-1">
              {sector.stocks.map(stock => {
                const isPos = stock.changePct >= 0;
                // Intensity based on absolute change (max 5%)
                const intensity = Math.min(Math.abs(stock.changePct || 0) / 5, 1);
                
                // Construct a background color that scales with intensity
                const bgStyle = isPos 
                  ? `rgba(16, 185, 129, ${0.1 + intensity * 0.4})` // Emerald
                  : `rgba(239, 68, 68, ${0.1 + intensity * 0.4})`; // Red

                return (
                  <div 
                    key={stock.ticker}
                    className="p-3 rounded-lg border border-white/[0.03] flex flex-col justify-center items-center text-center cursor-default transition-all hover:scale-[1.02]"
                    style={{ backgroundColor: bgStyle }}
                    title={`${stock.ticker}: ${stock.signal}`}
                  >
                    <div className="font-bold text-slate-100 text-sm tracking-tight">{stock.ticker}</div>
                    <div className="font-mono text-xs opacity-90 mt-1 mix-blend-plus-lighter text-white">
                      {isPos ? '+' : ''}{stock.changePct?.toFixed(2)}%
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
