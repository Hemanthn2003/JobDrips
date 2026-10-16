// --------------------------------------------------
// Who is connected to whom (used by the recommendations page).
//
// Two jobs, both plain functions without database access so they can be tested:
//
//   1. collectEngagement  - people (friends or NOT) who liked / commented on /
//      shared / saved my friends' posts, or liked / viewed my friends' stories.
//      Also returns the friends of my friends.
//   2. mutualFriendIds    - friends that two people have in common.
// --------------------------------------------------

export interface GraphProfile {
  userid: string;
  friends?: Array<{ userid: string; friendshipAccepted?: boolean }>;
  posts?: Array<{
    archived?: boolean;
    likes?: Array<{ userId?: string }>;
    comments?: Array<{ userId?: string; likes?: string[]; visible?: boolean }>;
    shares?: Array<{ fromUserId?: string }>;
    saves?: Array<{ userId?: string }>;
  }>;
  stories?: Array<{ likes?: string[]; viewers?: Array<{ userId?: string }> }>;
}

/** How much each kind of interaction says about a person ("they like my friends' things"). */
export const ENGAGEMENT_WEIGHT = {
  like: 2,
  comment: 2,
  share: 3,
  save: 2,
  /** the friend (post owner) liked this person's comment back */
  likedBackByOwner: 2,
  storyLike: 2,
  storyView: 1,
} as const;

export const acceptedFriendIds = (profile?: GraphProfile | null): string[] =>
  (profile?.friends ?? [])
    .filter((friend) => friend.friendshipAccepted)
    .map((friend) => friend.userid);

/**
 * Friends I have in common with `person`. Neither of us is ever listed as our
 * own mutual friend.
 */
export const mutualFriendIds = (
  myFriends: ReadonlySet<string>,
  person?: GraphProfile | null,
  myId = "",
): string[] => {
  const seen = new Set<string>();

  for (const id of acceptedFriendIds(person)) {
    if (id === myId || id === person?.userid) continue;
    if (myFriends.has(id)) seen.add(id);
  }

  return [...seen];
};

export const collectEngagement = (
  friendDocs: GraphProfile[],
  excluded: ReadonlySet<string>,
): { engagement: Map<string, number>; friendsOfFriends: Set<string> } => {
  const engagement = new Map<string, number>();
  const friendsOfFriends = new Set<string>();

  for (const friend of friendDocs) {
    // A friend's own activity on their own content proves nothing.
    const bump = (id: string | undefined, amount: number) => {
      if (!id || id === friend.userid || excluded.has(id)) return;
      engagement.set(id, (engagement.get(id) ?? 0) + amount);
    };

    for (const post of friend.posts ?? []) {
      if (post.archived) continue;

      for (const like of post.likes ?? []) bump(like.userId, ENGAGEMENT_WEIGHT.like);

      for (const comment of post.comments ?? []) {
        if (comment.visible === false) continue;
        bump(comment.userId, ENGAGEMENT_WEIGHT.comment);
        // The owner of the post liked this comment: they welcomed that person.
        if ((comment.likes ?? []).includes(friend.userid)) {
          bump(comment.userId, ENGAGEMENT_WEIGHT.likedBackByOwner);
        }
      }

      for (const share of post.shares ?? []) bump(share.fromUserId, ENGAGEMENT_WEIGHT.share);
      for (const save of post.saves ?? []) bump(save.userId, ENGAGEMENT_WEIGHT.save);
    }

    for (const story of friend.stories ?? []) {
      for (const id of story.likes ?? []) bump(id, ENGAGEMENT_WEIGHT.storyLike);
      for (const viewer of story.viewers ?? []) bump(viewer.userId, ENGAGEMENT_WEIGHT.storyView);
    }

    for (const other of friend.friends ?? []) {
      if (other.friendshipAccepted && other.userid !== friend.userid && !excluded.has(other.userid)) {
        friendsOfFriends.add(other.userid);
      }
    }
  }

  return { engagement, friendsOfFriends };
};
