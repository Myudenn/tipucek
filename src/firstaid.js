// TipuCek — interactive first aid ("it already happened, act now").
//
// Four scenarios, three steps each. The step texts live in the i18n
// table (aidMoney1-3, aidLink1-3, aidApk1-3, aidOtp1-3) so the guide
// speaks the user's language. This is general guidance, not legal or
// financial advice — the UI says so (aidNote).

export const AID_SCENARIOS = [
  { id: "money", optKey: "aidOptMoney", steps: ["aidMoney1", "aidMoney2", "aidMoney3"] },
  { id: "link", optKey: "aidOptLink", steps: ["aidLink1", "aidLink2", "aidLink3"] },
  { id: "apk", optKey: "aidOptApk", steps: ["aidApk1", "aidApk2", "aidApk3"] },
  { id: "otp", optKey: "aidOptOtp", steps: ["aidOtp1", "aidOtp2", "aidOtp3"] },
];
