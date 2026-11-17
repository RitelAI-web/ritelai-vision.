//+------------------------------------------------------------------+
//| RitelAI Auto Trader DEMO v1.0                                    |
//| Local rule-based test EA. DEMO ONLY; not an AI accuracy claim.   |
//+------------------------------------------------------------------+
#property strict
#property version   "1.00"
#property description "RitelAI XAUUSD demo strategy: EMA + RSI + MACD + ATR risk controls"

#include <Trade/Trade.mqh>
CTrade trade;

input string InpSymbol = "XAUUSD.s";
input ENUM_TIMEFRAMES InpTimeframe = PERIOD_M5;
input double InpRiskPercent = 0.5;          // Hard cap: 0.5% equity per trade
input double InpDailyLossLimitPct = 2.0;   // Stop new entries after 2% daily equity loss
input int InpMaxSpreadPoints = 80;
input ulong InpMagic = 26111701;
input int InpFastEMA = 20;
input int InpSlowEMA = 50;
input int InpRSIPeriod = 14;
input int InpATRPeriod = 14;
input double InpSL_ATR = 1.5;
input double InpTP_ATR = 2.25;
input bool InpRequireDemo = true;

int hFast=INVALID_HANDLE, hSlow=INVALID_HANDLE, hRSI=INVALID_HANDLE;
int hMACD=INVALID_HANDLE, hATR=INVALID_HANDLE;
datetime lastBar=0;
double dayStartEquity=0;
int dayKey=0;
bool halted=false;

int DateKey(datetime t) {
   MqlDateTime d; TimeToStruct(t,d);
   return d.year*10000+d.mon*100+d.day;
}
string DayKeyName() { return "RitelAI_DayStart_"+(string)AccountInfoInteger(ACCOUNT_LOGIN)+"_"+(string)DateKey(TimeCurrent()); }

bool IsNewBar() {
   datetime t=iTime(InpSymbol,InpTimeframe,0);
   if(t==0 || t==lastBar) return false;
   lastBar=t; return true;
}
bool ReadOne(int handle,int buffer,int shift,double &value) {
   double a[]; ArraySetAsSeries(a,true);
   if(CopyBuffer(handle,buffer,shift,1,a)!=1) return false;
   value=a[0]; return MathIsValidNumber(value);
}
double NormalizeVolume(double v) {
   double step=SymbolInfoDouble(InpSymbol,SYMBOL_VOLUME_STEP);
   double vmin=SymbolInfoDouble(InpSymbol,SYMBOL_VOLUME_MIN);
   double vmax=SymbolInfoDouble(InpSymbol,SYMBOL_VOLUME_MAX);
   if(step<=0) return 0;
   v=MathFloor(v/step)*step;
   v=MathMin(v,vmax);
   if(v<vmin) return 0; // Never round risk upward to broker minimum.
   int digits=2;
   if(step<0.01) digits=3;
   if(step<0.001) digits=4;
   return NormalizeDouble(v,digits);
}
double CalcLots(double entry,double sl) {
   double riskMoney=AccountInfoDouble(ACCOUNT_EQUITY)*InpRiskPercent/100.0;
   double tickSize=SymbolInfoDouble(InpSymbol,SYMBOL_TRADE_TICK_SIZE);
   double tickValue=SymbolInfoDouble(InpSymbol,SYMBOL_TRADE_TICK_VALUE_LOSS);
   if(tickValue<=0) tickValue=SymbolInfoDouble(InpSymbol,SYMBOL_TRADE_TICK_VALUE);
   double distance=MathAbs(entry-sl);
   if(riskMoney<=0 || tickSize<=0 || tickValue<=0 || distance<=0) return 0;
   double lossPerLot=(distance/tickSize)*tickValue;
   if(lossPerLot<=0) return 0;
   return NormalizeVolume(riskMoney/lossPerLot);
}
bool HasOurPosition() {
   for(int i=PositionsTotal()-1;i>=0;i--) {
      ulong ticket=PositionGetTicket(i);
      if(ticket>0 && PositionGetString(POSITION_SYMBOL)==InpSymbol &&
         (ulong)PositionGetInteger(POSITION_MAGIC)==InpMagic) return true;
   }
   return false;
}
void RefreshDailyLimit() {
   int k=DateKey(TimeCurrent());
   if(k!=dayKey) {
      dayKey=k;
      string key=DayKeyName();
      if(GlobalVariableCheck(key)) dayStartEquity=GlobalVariableGet(key);
      else {
         dayStartEquity=AccountInfoDouble(ACCOUNT_EQUITY);
         GlobalVariableSet(key,dayStartEquity);
      }
      halted=false;
   }
   if(dayStartEquity>0) {
      double dd=(dayStartEquity-AccountInfoDouble(ACCOUNT_EQUITY))/dayStartEquity*100.0;
      if(dd>=InpDailyLossLimitPct) halted=true;
   }
}
void EvaluateAndTrade() {
   if(halted || !IsNewBar() || HasOurPosition()) return;
   MqlTick tick;
   if(!SymbolInfoTick(InpSymbol,tick) || tick.ask<=0 || tick.bid<=0) return;
   double point=SymbolInfoDouble(InpSymbol,SYMBOL_POINT);
   if(point<=0 || (tick.ask-tick.bid)/point>InpMaxSpreadPoints) return;

   double fast,slow,rsi,macdMain,macdSignal,atr;
   if(!ReadOne(hFast,0,1,fast) || !ReadOne(hSlow,0,1,slow) ||
      !ReadOne(hRSI,0,1,rsi) || !ReadOne(hMACD,0,1,macdMain) ||
      !ReadOne(hMACD,1,1,macdSignal) || !ReadOne(hATR,0,1,atr) || atr<=0) return;

   bool buy=(fast>slow && rsi>=55.0 && macdMain>macdSignal);
   bool sell=(fast<slow && rsi<=45.0 && macdMain<macdSignal);
   if(!buy && !sell) return;

   int digits=(int)SymbolInfoInteger(InpSymbol,SYMBOL_DIGITS);
   double entry=buy?tick.ask:tick.bid;
   double sl=buy?entry-InpSL_ATR*atr:entry+InpSL_ATR*atr;
   double tp=buy?entry+InpTP_ATR*atr:entry-InpTP_ATR*atr;
   sl=NormalizeDouble(sl,digits); tp=NormalizeDouble(tp,digits);
   double lots=CalcLots(entry,sl);
   if(lots<=0) { Print("RitelAI: volume below broker minimum or risk calculation unavailable; skipped."); return; }

   trade.SetExpertMagicNumber(InpMagic);
   trade.SetDeviationInPoints(20);
   trade.SetTypeFillingBySymbol(InpSymbol);
   bool ok=buy?trade.Buy(lots,InpSymbol,0,sl,tp,"RitelAI DEMO EMA RSI MACD"):
               trade.Sell(lots,InpSymbol,0,sl,tp,"RitelAI DEMO EMA RSI MACD");
   Print("RitelAI DEMO signal=",buy?"BUY":"SELL"," lots=",lots,
         " entry=",entry," SL=",sl," TP=",tp,
         " retcode=",trade.ResultRetcode()," ",trade.ResultRetcodeDescription(),
         " success=",ok);
}
int OnInit() {
   if(InpRequireDemo && AccountInfoInteger(ACCOUNT_TRADE_MODE)!=ACCOUNT_TRADE_MODE_DEMO) {
      Print("RitelAI STOP: DEMO account required. No trading.");
      return INIT_FAILED;
   }
   if(InpRiskPercent<=0 || InpRiskPercent>0.5 || InpDailyLossLimitPct<=0 ||
      InpDailyLossLimitPct>2.0 || InpMaxSpreadPoints<1 || InpMaxSpreadPoints>80 ||
      InpSL_ATR<=0 || InpTP_ATR<=0) {
      Print("RitelAI STOP: risk settings exceed hard safety limits.");
      return INIT_PARAMETERS_INCORRECT;
   }
   if(!SymbolSelect(InpSymbol,true)) {
      Print("RitelAI STOP: symbol not available: ",InpSymbol);
      return INIT_FAILED;
   }
   hFast=iMA(InpSymbol,InpTimeframe,InpFastEMA,0,MODE_EMA,PRICE_CLOSE);
   hSlow=iMA(InpSymbol,InpTimeframe,InpSlowEMA,0,MODE_EMA,PRICE_CLOSE);
   hRSI=iRSI(InpSymbol,InpTimeframe,InpRSIPeriod,PRICE_CLOSE);
   hMACD=iMACD(InpSymbol,InpTimeframe,12,26,9,PRICE_CLOSE);
   hATR=iATR(InpSymbol,InpTimeframe,InpATRPeriod);
   if(hFast==INVALID_HANDLE || hSlow==INVALID_HANDLE || hRSI==INVALID_HANDLE ||
      hMACD==INVALID_HANDLE || hATR==INVALID_HANDLE) {
      Print("RitelAI STOP: indicator initialization failed."); return INIT_FAILED;
   }
   dayKey=DateKey(TimeCurrent());
   string key=DayKeyName();
   if(GlobalVariableCheck(key)) dayStartEquity=GlobalVariableGet(key);
   else { dayStartEquity=AccountInfoDouble(ACCOUNT_EQUITY); GlobalVariableSet(key,dayStartEquity); }
   EventSetTimer(2);
   Print("RitelAI Auto Trader DEMO v1.0 initialized. Strategy signals are rule-based, not guaranteed.");
   return INIT_SUCCEEDED;
}
void OnTimer() { RefreshDailyLimit(); EvaluateAndTrade(); }
void OnDeinit(const int reason) {
   EventKillTimer();
   if(hFast!=INVALID_HANDLE) IndicatorRelease(hFast);
   if(hSlow!=INVALID_HANDLE) IndicatorRelease(hSlow);
   if(hRSI!=INVALID_HANDLE) IndicatorRelease(hRSI);
   if(hMACD!=INVALID_HANDLE) IndicatorRelease(hMACD);
   if(hATR!=INVALID_HANDLE) IndicatorRelease(hATR);
   Comment("");
}
