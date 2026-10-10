export const PLANS = {
  install: { label: "설치판", daily: 0, monthly: 0, spendCap: 0 },
  trial: { label: "체험", daily: 1, monthly: 1, spendCap: 240 },
  standard: { label: "스탠다드", daily: 8, monthly: 15, spendCap: 3600 },
  premium: { label: "프리미엄", daily: 15, monthly: 30, spendCap: 7200 },
  family_standard: { label: "스탠다드 지인", daily: 8, monthly: 15, spendCap: 3600 },
  family_premium: { label: "프리미엄 지인", daily: 15, monthly: 30, spendCap: 7200 },
};

export const CASE_COUNT = 1;
export const SAFETY_WON = 240;

export function planOf(name) {
  return PLANS[name] || null;
}
