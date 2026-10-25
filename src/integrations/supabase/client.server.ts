import { rest } from "@/lib/nowpayments.server";

type SupabaseError = { message: string; code?: string };

type InsertBuilder = {
  insert: (values: Record<string, unknown>) => Promise<{ data: unknown; error: SupabaseError | null }>;
};

export const supabaseAdmin = {
  auth: {
    admin: {
      async createUser(input: {
        email: string;
        password: string;
        email_confirm?: boolean;
        user_metadata?: Record<string, unknown>;
      }) {
        const response = await rest("/auth/v1/admin/users", {
          admin: true,
          method: "POST",
          body: JSON.stringify({
            email: input.email,
            password: input.password,
            email_confirm: input.email_confirm ?? false,
            user_metadata: input.user_metadata ?? {},
          }),
        });
        const body = (await response.json().catch(() => null)) as
          | { id?: string; user?: { id?: string }; message?: string; error_description?: string }
          | null;
        if (!response.ok) {
          return {
            data: { user: null },
            error: {
              message: body?.message ?? body?.error_description ?? `Supabase returned ${response.status}`,
            },
          };
        }
        const user = body?.user ?? body;
        return { data: { user }, error: null };
      },
    },
  },
  from(table: string): InsertBuilder {
    return {
      async insert(values: Record<string, unknown>) {
        const response = await rest(
          `/rest/v1/${encodeURIComponent(table)}`,
          {
            admin: true,
            method: "POST",
            headers: { Prefer: "return=minimal" },
            body: JSON.stringify(values),
          },
        );
        if (response.ok) return { data: null, error: null };
        const body = (await response.json().catch(() => null)) as { message?: string; hint?: string } | null;
        return {
          data: null,
          error: { message: body?.message ?? body?.hint ?? `Supabase returned ${response.status}` },
        };
      },
    };
  },
};

