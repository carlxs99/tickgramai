export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      deposit_bonuses: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          percent: number
          source_gift_box_id: string | null
          used_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          percent: number
          source_gift_box_id?: string | null
          used_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          percent?: number
          source_gift_box_id?: string | null
          used_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deposit_bonuses_source_gift_box_id_fkey"
            columns: ["source_gift_box_id"]
            isOneToOne: false
            referencedRelation: "gift_boxes"
            referencedColumns: ["id"]
          },
        ]
      }
      deposits: {
        Row: {
          amount_ton: number
          created_at: string
          gram_per_day: number
          id: string
          status: string
          tx_hash: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_ton: number
          created_at?: string
          gram_per_day?: number
          id?: string
          status?: string
          tx_hash?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_ton?: number
          created_at?: string
          gram_per_day?: number
          id?: string
          status?: string
          tx_hash?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      gift_boxes: {
        Row: {
          created_at: string
          id: string
          opened_at: string | null
          prize_amount: number | null
          prize_type: string | null
          source: string
          source_ref_id: string | null
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          opened_at?: string | null
          prize_amount?: number | null
          prize_type?: string | null
          source?: string
          source_ref_id?: string | null
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          opened_at?: string | null
          prize_amount?: number | null
          prize_type?: string | null
          source?: string
          source_ref_id?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      partner_task_completions: {
        Row: {
          created_at: string
          id: string
          partner_task_id: string
          reward: number
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          partner_task_id: string
          reward: number
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          partner_task_id?: string
          reward?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_task_completions_partner_task_id_fkey"
            columns: ["partner_task_id"]
            isOneToOne: false
            referencedRelation: "partner_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_tasks: {
        Row: {
          cost_ton: number
          created_at: string
          current_clicks: number
          id: string
          kind: string
          link: string
          memo_tag: string
          owner_id: string
          reward_per_click: number
          status: string
          target_clicks: number
          title: string
          tx_hash: string | null
          updated_at: string
        }
        Insert: {
          cost_ton: number
          created_at?: string
          current_clicks?: number
          id?: string
          kind?: string
          link: string
          memo_tag: string
          owner_id: string
          reward_per_click?: number
          status?: string
          target_clicks: number
          title: string
          tx_hash?: string | null
          updated_at?: string
        }
        Update: {
          cost_ton?: number
          created_at?: string
          current_clicks?: number
          id?: string
          kind?: string
          link?: string
          memo_tag?: string
          owner_id?: string
          reward_per_click?: number
          status?: string
          target_clicks?: number
          title?: string
          tx_hash?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      processed_tx: {
        Row: {
          amount_ton: number
          gram_credited: number
          memo: string | null
          processed_at: string
          tx_hash: string
          user_id: string | null
        }
        Insert: {
          amount_ton: number
          gram_credited: number
          memo?: string | null
          processed_at?: string
          tx_hash: string
          user_id?: string | null
        }
        Update: {
          amount_ton?: number
          gram_credited?: number
          memo?: string | null
          processed_at?: string
          tx_hash?: string
          user_id?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          balance: number
          created_at: string
          deposit_total: number
          first_name: string | null
          id: string
          is_premium: boolean
          language_code: string | null
          last_collect_at: string
          last_daily_gift_at: string | null
          last_name: string | null
          memo_tag: string
          mining_rate: number
          mining_rate_usd: number
          mining_rate_usdt: number
          refback_paid: number
          refback_rate: number
          referral_code: string | null
          referral_earned_total: number
          referred_by: string | null
          telegram_id: number | null
          updated_at: string
          user_id: string
          username: string | null
          wallet_address: string | null
        }
        Insert: {
          avatar_url?: string | null
          balance?: number
          created_at?: string
          deposit_total?: number
          first_name?: string | null
          id?: string
          is_premium?: boolean
          language_code?: string | null
          last_collect_at?: string
          last_daily_gift_at?: string | null
          last_name?: string | null
          memo_tag?: string
          mining_rate?: number
          mining_rate_usd?: number
          mining_rate_usdt?: number
          refback_paid?: number
          refback_rate?: number
          referral_code?: string | null
          referral_earned_total?: number
          referred_by?: string | null
          telegram_id?: number | null
          updated_at?: string
          user_id: string
          username?: string | null
          wallet_address?: string | null
        }
        Update: {
          avatar_url?: string | null
          balance?: number
          created_at?: string
          deposit_total?: number
          first_name?: string | null
          id?: string
          is_premium?: boolean
          language_code?: string | null
          last_collect_at?: string
          last_daily_gift_at?: string | null
          last_name?: string | null
          memo_tag?: string
          mining_rate?: number
          mining_rate_usd?: number
          mining_rate_usdt?: number
          refback_paid?: number
          refback_rate?: number
          referral_code?: string | null
          referral_earned_total?: number
          referred_by?: string | null
          telegram_id?: number | null
          updated_at?: string
          user_id?: string
          username?: string | null
          wallet_address?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_referred_by_fkey"
            columns: ["referred_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      referral_milestone_claims: {
        Row: {
          claimed_at: string
          reward: number
          tier: number
          user_id: string
        }
        Insert: {
          claimed_at?: string
          reward: number
          tier: number
          user_id: string
        }
        Update: {
          claimed_at?: string
          reward?: number
          tier?: number
          user_id?: string
        }
        Relationships: []
      }
      referrals: {
        Row: {
          bonus_earned: number
          created_at: string
          id: string
          referred_id: string
          referrer_id: string
        }
        Insert: {
          bonus_earned?: number
          created_at?: string
          id?: string
          referred_id: string
          referrer_id: string
        }
        Update: {
          bonus_earned?: number
          created_at?: string
          id?: string
          referred_id?: string
          referrer_id?: string
        }
        Relationships: []
      }
      tasks: {
        Row: {
          code: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          kind: string
          link: string | null
          min_deposit: number
          reward: number
          target_chat: string | null
          title: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          kind?: string
          link?: string | null
          min_deposit?: number
          reward?: number
          target_chat?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          kind?: string
          link?: string | null
          min_deposit?: number
          reward?: number
          target_chat?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_tasks: {
        Row: {
          completed_on: string
          created_at: string
          id: string
          reward: number
          task_id: string
          user_id: string
        }
        Insert: {
          completed_on?: string
          created_at?: string
          id?: string
          reward?: number
          task_id: string
          user_id: string
        }
        Update: {
          completed_on?: string
          created_at?: string
          id?: string
          reward?: number
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_tasks_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      withdrawals: {
        Row: {
          address: string
          amount: number
          attempts: number
          created_at: string
          error_message: string | null
          fee: number
          id: string
          memo: string | null
          net_amount: number
          paid_at: string | null
          processed_at: string | null
          status: string
          tx_hash: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          address: string
          amount: number
          attempts?: number
          created_at?: string
          error_message?: string | null
          fee?: number
          id?: string
          memo?: string | null
          net_amount?: number
          paid_at?: string | null
          processed_at?: string | null
          status?: string
          tx_hash?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          address?: string
          amount?: number
          attempts?: number
          created_at?: string
          error_message?: string | null
          fee?: number
          id?: string
          memo?: string | null
          net_amount?: number
          paid_at?: string | null
          processed_at?: string | null
          status?: string
          tx_hash?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _set_cron_secret: { Args: { _value: string }; Returns: undefined }
      atomic_add_balance: {
        Args: { _amount: number; _user_id: string }
        Returns: number
      }
      atomic_add_mining_rate: {
        Args: {
          _add_deposit_ton?: number
          _add_rate_gram: number
          _add_rate_usd: number
          _user_id: string
        }
        Returns: {
          new_deposit_total: number
          new_rate_gram: number
          new_rate_usd: number
        }[]
      }
      atomic_collect_income: {
        Args: { _user_id: string }
        Returns: {
          gained: number
          new_balance: number
        }[]
      }
      atomic_collect_income_usd: {
        Args: { _ton_price: number; _user_id: string }
        Returns: {
          gained: number
          new_balance: number
        }[]
      }
      atomic_decrement_balance: {
        Args: { _amount: number; _user_id: string }
        Returns: number
      }
      claim_daily_gift_box: {
        Args: { _user_id: string }
        Returns: {
          box_id: string
          next_claim_at: string
        }[]
      }
      claim_referral_milestone:
        | {
            Args: { _tier: number }
            Returns: {
              new_balance: number
              reward: number
            }[]
          }
        | {
            Args: { _tier: number; _user_id: string }
            Returns: {
              new_balance: number
              reward: number
            }[]
          }
      complete_partner_task: {
        Args: { _partner_task_id: string; _user_id: string }
        Returns: {
          new_balance: number
          remaining_clicks: number
          reward: number
        }[]
      }
      complete_task: {
        Args: { _task_id: string; _user_id: string }
        Returns: {
          completed_on: string
          reward: number
        }[]
      }
      consume_active_deposit_bonus: {
        Args: { _user_id: string }
        Returns: number
      }
      expire_stale_pending_deposits: { Args: never; Returns: number }
      generate_memo_tag: { Args: never; Returns: string }
      generate_partner_memo: { Args: never; Returns: string }
      get_referral_ancestors: {
        Args: { _user_id: string }
        Returns: {
          first_name: string
          level: number
          refback_rate: number
          telegram_id: number
          user_id: string
        }[]
      }
      get_referral_stats: { Args: { _user_id: string }; Returns: Json }
      get_top_miners: {
        Args: { _limit?: number }
        Returns: {
          avatar_url: string
          balance: number
          first_name: string
          mining_rate: number
          mining_rate_usd: number
          username: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      list_active_partner_tasks: {
        Args: { _user_id: string }
        Returns: {
          current_clicks: number
          id: string
          kind: string
          link: string
          owner_id: string
          reward_per_click: number
          status: string
          target_clicks: number
          title: string
        }[]
      }
      list_referral_milestones: {
        Args: { _user_id: string }
        Returns: {
          active_count: number
          claimed: boolean
          required: number
          reward: number
          tier: number
        }[]
      }
      open_gift_box: {
        Args: { _box_id: string; _user_id: string }
        Returns: {
          bonus_expires_at: string
          mining_rate_gram: number
          prize_amount: number
          prize_type: string
        }[]
      }
    }
    Enums: {
      app_role: "admin" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const
