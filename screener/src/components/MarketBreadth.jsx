import { useMemo } from 'react';
import { useStore } from '../lib/store';
import { TrendingUp, TrendingDown, Activity, Zap } from 'lucide-react';

export default function MarketBreadth() {
  const { screenerData } = useStore();
  const data = Object.values(screenerData);

  const metrics = useMemo(() => {
    if (!data.length) return null;
    
    let advances = 0;
    let declines = 0;
    let aboveEma21 = 0;
    let totalRsi = 0;
    let totalScore = 0;

    data.forEach(d => {
      if (d.changePct > 0) advances++;
      else if (d.changePct < 0) declines++;
      
      if (d.ema21 && d.ltp > d.ema21) aboveEma21++;
      if (d.rsi) totalRsi += d.rsi;
      if (d.signalScore) totalScore += d.signalScore;
    });

    const adRatio = declines > 0 ? (advances / declines).toFixed(2) : advances > 0 ? '∞' : '1.0';
    const emaPct = Math.round((aboveEma21 / data.length) * 100);
    const avgRsi = Math.round(totalRsi / data.length);
    const avgScore = Math.round(totalScore / data.length);

    let mood = 'Neutral';
    let moodColor = 'text-slate-400';
    if (avgScore > 20) { mood = 'Bullish'; moodColor = 'text-emerald-400'; }
    else if (avgScore < -20) { mood = 'Bearish'; moodColor = 'text-red-400'; }

    return { advances, declines, adRatio, emaPct, avgRsi, mood, moodColor, avgScore };
  }, [data]);

  if (!metrics) return null;

  return (
    <div className="bg-[#080d18] border-b border-white/[0.05] p-3 flex gap-6 overflow-x-auto text-xs shrink-0">
      <div className="flex items-center gap-2 border-r border-white/5 pr-6">
        <div className="w-6 h-6 rounded bg-slate-800 flex items-center justify-center">
          <Activity size={14} className="text-slate-400" />
        </div>
        <div>
          <div className="text-slate-500 font-medium mb-0.5">Market Mood</div>
          <div className={`font-semibold ${metrics.moodColor}`}>{metrics.mood} <span className="text-[10px] opacity-70 ml-1">({metrics.avgScore})</span></div>
        </div>
      </div>

      <div className="flex items-center gap-2 border-r border-white/5 pr-6">
        <div className="w-6 h-6 rounded bg-emerald-500/10 flex items-center justify-center">
          <TrendingUp size={14} className="text-emerald-400" />
        </div>
        <div>
          <div className="text-slate-500 font-medium mb-0.5">A/D Ratio</div>
          <div className="font-mono text-slate-300">
            {metrics.adRatio} <span className="text-emerald-400 ml-1">{metrics.advances}</span> / <span className="text-red-400">{metrics.declines}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 border-r border-white/5 pr-6">
        <div className="w-6 h-6 rounded bg-blue-500/10 flex items-center justify-center">
          <Zap size={14} className="text-blue-400" />
        </div>
        <div>
          <div className="text-slate-500 font-medium mb-0.5">% &gt; EMA 21</div>
          <div className="font-mono text-slate-300">
            {metrics.emaPct}%
            <div className="w-16 h-1 bg-slate-800 rounded-full mt-1 overflow-hidden inline-block ml-2 align-middle">
              <div className="h-full bg-blue-500" style={{ width: `${metrics.emaPct}%` }}></div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded bg-purple-500/10 flex items-center justify-center">
          <TrendingDown size={14} className="text-purple-400" />
        </div>
        <div>
          <div className="text-slate-500 font-medium mb-0.5">Avg RSI</div>
          <div className={`font-mono ${metrics.avgRsi > 60 ? 'text-emerald-400' : metrics.avgRsi < 40 ? 'text-red-400' : 'text-slate-300'}`}>
            {metrics.avgRsi}
          </div>
        </div>
      </div>
    </div>
  );
}
