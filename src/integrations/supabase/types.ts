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
          last_collect_at: string
          last_name: string | null
          memo_tag: string
          mining_rate: number
          referral_code: string | null
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
          last_collect_at?: string
          last_name?: string | null
          memo_tag?: string
          mining_rate?: number
          referral_code?: string | null
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
          last_collect_at?: string
          last_name?: string | null
          memo_tag?: string
          mining_rate?: number
          referral_code?: string | null
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
          min_deposit: number
          reward: number
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
          min_deposit?: number
          reward?: number
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
          min_deposit?: number
          reward?: number
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
          created_at: string
          fee: number
          id: string
          memo: string | null
          net_amount: number
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          address: string
          amount: number
          created_at?: string
          fee?: number
          id?: string
          memo?: string | null
          net_amount?: number
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          address?: string
          amount?: number
          created_at?: string
          fee?: number
          id?: string
          memo?: string | null
          net_amount?: number
          status?: string
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
      generate_memo_tag: { Args: never; Returns: string }
      get_top_miners: {
        Args: { _limit?: number }
        Returns: {
          avatar_url: string
          balance: number
          first_name: string
          mining_rate: number
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
