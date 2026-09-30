export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'paused'
  | 'incomplete'
  | 'none';

export type PlanSlug = 'free' | 'starter' | 'pro' | 'enterprise';

export interface Plan {
  id: string;
  slug: PlanSlug;
  name: string;
  description: string | null;
  price_monthly_usd: number;
  price_yearly_usd: number;
  max_contacts: number;
  max_agents: number;
  max_messages_per_month: number;
  max_broadcasts_per_month: number;
  max_flows: number;
  feature_ai_reply: boolean;
  feature_broadcasts: boolean;
  feature_flows: boolean;
  feature_api_access: boolean;
  feature_white_label: boolean;
  is_public: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Subscription {
  id: string;
  account_id: string;
  plan_id: string;
  status: SubscriptionStatus;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  trial_ends_at: string | null;
  canceled_at: string | null;
  messages_used_this_month: number;
  broadcasts_used_this_month: number;
  created_at: string;
  updated_at: string;
}

export interface AccountPlanDetails {
  plan_slug: PlanSlug;
  plan_name: string;
  sub_status: SubscriptionStatus;
  max_contacts: number;
  max_agents: number;
  max_messages_per_month: number;
  max_broadcasts_per_month: number;
  max_flows: number;
  feature_ai_reply: boolean;
  feature_broadcasts: boolean;
  feature_flows: boolean;
  feature_api_access: boolean;
  feature_white_label: boolean;
  messages_used_this_month: number;
  current_period_end: string | null;
  // Current usage stats calculated live
  contacts_count?: number;
  agents_count?: number;
  flows_count?: number;
}
