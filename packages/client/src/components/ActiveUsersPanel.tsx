// ── ActiveUsersPanel: floating "who's online" panel ─────────────────────────
//
// P5-T30. Ported (structure/behavior, not pixel-for-pixel styling) from the
// legacy figmalade prototype's `src/components/ActiveUsersPanel.tsx` —
// colored dot + name per online user, a Follow button per remote — adapted
// to take plain data (`localUser`/`remotes`, sourced from
// `hooks/usePresence.ts`) and follow-mode state as props
// (`followClientId`/`onFollow`, sourced from `hooks/useFollowMode.ts`)
// instead of subscribing to a `BoardRoom`'s awareness directly, keeping this
// component pure render logic. Each row shows an explicit "Follow"/"Stop"
// button (rather than the legacy's click-the-avatar-to-toggle gesture),
// which keeps every entry's control unambiguous for both users and tests.
import type { PresenceUser } from '@easel/shared';
import type { RemotePresence } from '../hooks/usePresence.js';

export interface ActiveUsersPanelProps {
  localUser: PresenceUser;
  remotes: RemotePresence[];
  /** The clientId currently being followed (useFollowMode.ts), or null. */
  followClientId: number | null;
  /** Called with a remote's clientId to start following it, or `null` to stop. */
  onFollow: (clientId: number | null) => void;
}

interface Entry {
  clientId: number | null;
  user: PresenceUser;
  isLocal: boolean;
  isAI: boolean;
  agentClient?: string;
}

function Dot({ color }: { color: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 10,
        height: 10,
        borderRadius: '50%',
        background: color,
        flexShrink: 0,
      }}
    />
  );
}

export function ActiveUsersPanel({
  localUser,
  remotes,
  followClientId,
  onFollow,
}: ActiveUsersPanelProps) {
  const entries: Entry[] = [
    { clientId: null, user: localUser, isLocal: true, isAI: false },
    ...remotes.map((r) => ({
      clientId: r.clientId,
      user: r.user,
      isLocal: false,
      isAI: r.isAI,
      agentClient: r.agentClient,
    })),
  ];

  return (
    <div
      data-testid="active-users-panel"
      style={{
        position: 'absolute',
        top: 12,
        right: 12,
        zIndex: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        background: '#f8fafc',
        border: '1px solid #e2e8f0',
        borderRadius: 10,
        padding: '8px 10px',
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 12,
        minWidth: 160,
      }}
    >
      {entries.map((entry) => {
        const isFollowing = !entry.isLocal && followClientId === entry.clientId;
        return (
          <div
            key={entry.clientId ?? 'local'}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <Dot color={entry.user.color} />
            <span style={{ color: '#0f172a', fontWeight: 500 }}>
              {entry.user.name}
              {entry.isLocal ? ' (you)' : ''}
            </span>
            {entry.isAI && (
              <span
                data-testid={`active-users-ai-badge-${entry.clientId}`}
                style={{
                  background: '#0f172a',
                  color: 'white',
                  borderRadius: 3,
                  padding: '0 4px',
                  fontSize: 9,
                  fontWeight: 700,
                  lineHeight: '14px',
                }}
              >
                AI
              </span>
            )}
            {!entry.isLocal && (
              <button
                type="button"
                onClick={() => onFollow(isFollowing ? null : entry.clientId)}
                style={{
                  marginLeft: 'auto',
                  border: 'none',
                  background: isFollowing ? '#0f766e' : '#e2e8f0',
                  color: isFollowing ? 'white' : '#475569',
                  fontSize: 11,
                  fontWeight: 600,
                  padding: '3px 8px',
                  borderRadius: 6,
                  cursor: 'pointer',
                }}
              >
                {isFollowing ? 'Stop' : `Follow ${entry.user.name}`}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
