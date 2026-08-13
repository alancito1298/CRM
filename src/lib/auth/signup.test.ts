import { describe, expect, it, vi } from "vitest";

import { createConfirmedSupabaseUser } from "./signup";

describe("createConfirmedSupabaseUser", () => {
  it("creates a confirmed user with email_confirm enabled", async () => {
    const createUser = vi.fn().mockResolvedValue({
      data: { user: { id: "user-1", email: "test@example.com" } },
      error: null,
    });

    const adminClient = {
      auth: {
        admin: {
          createUser,
        },
      },
    } as unknown as Parameters<typeof createConfirmedSupabaseUser>[0];

    const result = await createConfirmedSupabaseUser(adminClient, {
      email: "test@example.com",
      password: "secret123",
      fullName: "Ada Lovelace",
    });

    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "test@example.com",
        password: "secret123",
        email_confirm: true,
        user_metadata: { full_name: "Ada Lovelace" },
      }),
    );
    expect(result.created).toBe(true);
    expect(result.existing).toBe(false);
  });
});
