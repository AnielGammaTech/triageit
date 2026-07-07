import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Post an internal (hidden-from-customer) note to a Halo ticket, resolving
 * @Name mentions to Halo's mention markup so the tech gets pinged.
 * Shared by the Prison Mike and Toby chat tools.
 */
export async function postInternalHaloNote(
  serviceClient: SupabaseClient,
  haloId: number,
  noteContent: string,
): Promise<string> {
  if (!noteContent?.trim()) return "Note content is empty — nothing to post.";

  const { data: integration } = await serviceClient
    .from("integrations")
    .select("config")
    .eq("service", "halo")
    .eq("is_active", true)
    .single();

  if (!integration) return "Halo PSA is not configured.";

  const cfg = integration.config as {
    base_url: string;
    client_id: string;
    client_secret: string;
    tenant?: string;
  };

  try {
    const tokenUrl = cfg.tenant
      ? `${cfg.base_url}/auth/token?tenant=${cfg.tenant}`
      : `${cfg.base_url}/auth/token`;
    const tokenRes = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: cfg.client_id,
        client_secret: cfg.client_secret,
        scope: "all",
      }),
    });

    if (!tokenRes.ok) return `Failed to authenticate with Halo: ${tokenRes.status}`;
    const { access_token } = (await tokenRes.json()) as { access_token: string };

    // Resolve @mentions — replace @Name with Halo's mention HTML
    let resolvedNote = noteContent;
    const mentionMatches = noteContent.match(/@[\w]+(?:\s[\w]+)?/g);
    if (mentionMatches) {
      for (const mention of mentionMatches) {
        const name = mention.slice(1);
        try {
          const agentRes = await fetch(
            `${cfg.base_url}/api/agent?search=${encodeURIComponent(name)}&count=3`,
            { headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" } },
          );
          if (agentRes.ok) {
            const agentData = (await agentRes.json()) as { agents?: ReadonlyArray<{ id: number; name: string }> };
            const match = (agentData.agents ?? []).find((a) =>
              a.name.toLowerCase().includes(name.toLowerCase()),
            );
            if (match) {
              const mentionHtml = `<span class="atwho-inserted" data-atwho-at="@"><span class="agent-tag" data-agent-id="${match.id}">@${match.name}</span></span>`;
              resolvedNote = resolvedNote.replace(mention, mentionHtml);
            }
          }
        } catch {
          // Keep plain text @mention if resolution fails
        }
      }
    }

    const actionRes = await fetch(`${cfg.base_url}/api/actions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        {
          ticket_id: haloId,
          note: resolvedNote,
          hiddenfromuser: true,
          outcome: "note",
        },
      ]),
    });

    if (!actionRes.ok) {
      const errText = await actionRes.text();
      return `Failed to post note to ticket #${haloId}: ${actionRes.status} — ${errText}`;
    }

    return `Internal note posted to ticket #${haloId} successfully.`;
  } catch (err) {
    return `Error posting note: ${err instanceof Error ? err.message : String(err)}`;
  }
}
