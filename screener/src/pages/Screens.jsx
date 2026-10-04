import React from 'react';
import { useStore } from '../lib/store';
import MarketBreadth from '../components/MarketBreadth';
import ScreenerTable from '../components/ScreenerTable';
import StockDetailPanel from '../components/StockDetailPanel';

export default function Screens() {
  const { selectedTicker } = useStore();

  return (
    <div className="absolute inset-0 flex">
      <div
        className="flex-1 overflow-auto"
        style={{ borderRight: selectedTicker ? `1px solid var(--border)` : 'none' }}
      >
        <MarketBreadth />
        <ScreenerTable />
      </div>
      {/* We keep StockDetailPanel here temporarily for backward compatibility 
          if the user clicks a row but doesn't navigate. But actually, we will
          change the row click to navigate to /company/:symbol. */}
    </div>
  );
}
