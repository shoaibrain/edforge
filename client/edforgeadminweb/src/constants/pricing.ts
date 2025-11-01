export const PRICING_PLANS = {
  basic: {
    id: "BASIC",
    name: "Basic",
    price: 29,
    description: "Perfect for small teams",
  },
  advanced: {
    id: "ADVANCED", 
    name: "Advanced",
    price: 99,
    description: "Ideal for growing businesses",
  },
  premium: {
    id: "PREMIUM",
    name: "Premium", 
    price: 299,
    description: "For large organizations",
  },
} as const

export type PricingPlan = typeof PRICING_PLANS[keyof typeof PRICING_PLANS]
