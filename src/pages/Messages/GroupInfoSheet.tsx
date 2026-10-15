import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Camera, LogOut, Plus, X } from "lucide-react";
import { useSocketEvent } from "../../lib/socket";
import { useConfirm } from "../../components/common/ConfirmModal";

const API = (import.meta.env.VITE_API_BASE_URL || "http://localhost:5000").replace(/\/+$/, "");
const MAX_MEMBERS = 40;

type Person = { userid: string; username: string; name?: string; profileimage?: string };
type Member = { userId: string; role: "admin" | "member"; person?: Person };
type Info = { conversationId: string; title: string; photoUrl: string; createdBy: string; members: Member[] };
type ApiResult<T> = { success: boolean; message?: string; data: T };

type Props = {
  conversationId: string;
  meId: string;
  friends: Person[];
  onClose: () => void;
  onChanged: () => void;
  onLeft: () => void;
};

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    credentials: "include",
    headers: { ...(init.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}), ...init.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.success === false) throw new Error(body.message || "Request failed.");
  return body as T;
}

function Avatar({ src, name, size = "h-11 w-11" }: { src?: string; name?: string; size?: string }) {
  return src
    ? <img src={src} alt="" className={`${size} shrink-0 rounded-2xl object-cover ring-1 ring-[#ead8cc]`} />
    : <div className={`${size} grid shrink-0 place-items-center rounded-2xl bg-[#f2dfd3] font-bold text-[#91452f]`}>{(name || "J").slice(0, 1).toUpperCase()}</div>;
}

const pill = "rounded-full border border-[#e2c7b9] px-3 py-1.5 text-xs font-semibold text-[#985438] disabled:opacity-50";

export default function GroupInfoSheet({ conversationId, meId, friends, onClose, onChanged, onLeft }: Props) {
  const { confirm, dialog } = useConfirm();
  const [info, setInfo] = useState<Info | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const photoInput = useRef<HTMLInputElement | null>(null);
  const path = `/api/messages/groups/${encodeURIComponent(conversationId)}`;

  const load = useCallback(async () => {
    try {
      const result = await api<ApiResult<Info>>(`${path}/info`);
      setInfo(result.data);
      setName((old) => old || result.data.title);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to load group."); }
  }, [path]);

  useEffect(() => { void load(); }, [load]);

  // Live: members / roles / photo changed by someone else.
  useSocketEvent<{ conversationId?: string }>("conversation:updated", (payload) => {
    if (!payload?.conversationId || payload.conversationId === conversationId) void load();
  });

  const patch = async (body: Record<string, unknown>) => {
    setBusy(true); setError("");
    try {
      await api(path, { method: "PATCH", body: JSON.stringify(body) });
      await load();
      onChanged();
      return true;
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to update group."); return false; }
    finally { setBusy(false); }
  };

  const changePhoto = async (file?: File) => {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { setError("Choose a JPG, PNG or WebP image."); return; }
    if (file.size > 5 * 1024 * 1024) { setError("Images must be 5 MB or smaller."); return; }
    setUploading(true); setError("");
    try {
      const form = new FormData();
      form.append("image", file);
      const uploaded = await api<ApiResult<{ secureUrl: string }>>("/api/uploads/image", { method: "POST", body: form });
      await patch({ action: "photo", photoUrl: uploaded.data.secureUrl });
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to upload photo."); }
    finally { setUploading(false); if (photoInput.current) photoInput.current.value = ""; }
  };

  const members = info?.members ?? [];
  const mine = members.find((m) => m.userId === meId);
  const isAdmin = mine?.role === "admin";
  const founderId = info?.createdBy ?? "";
  const candidates = friends.filter((f) => !members.some((m) => m.userId === f.userid));
  const room = MAX_MEMBERS - members.length;
  const labelOf = (m: Member) => m.person?.name || m.person?.username || "JobDrips member";

  const addSelected = async () => {
    if (!selected.length) return;
    const names = selected.map((id) => friends.find((f) => f.userid === id)?.username || "member");
    const ok = await confirm({
      title: selected.length === 1 ? "Add member?" : `Add ${selected.length} members?`,
      message: <><b>{names.join(", ")}</b> will be added to <b>{info?.title}</b> and can see new messages.</>,
      confirmText: "Add",
    });
    if (!ok) return;
    if (await patch({ action: "add", memberIds: selected })) { setSelected([]); setAdding(false); }
  };

  const removeMember = async (m: Member) => {
    const ok = await confirm({ title: "Remove member?", message: <><b>{labelOf(m)}</b> will be removed from the group.</>, confirmText: "Remove", tone: "danger" });
    if (ok) await patch({ action: "remove", userId: m.userId });
  };

  const changeRole = async (m: Member, action: "promote" | "demote") => {
    const ok = await confirm(action === "promote"
      ? { title: "Make admin?", message: <><b>{labelOf(m)}</b> will be able to add and remove members and edit the group.</>, confirmText: "Make admin" }
      : { title: "Remove as admin?", message: <><b>{labelOf(m)}</b> will become a regular member.</>, confirmText: "Remove admin", tone: "danger" });
    if (ok) await patch({ action, userId: m.userId });
  };

  const leave = async () => {
    const ok = await confirm({ title: "Leave this group?", message: "You will stop receiving messages from this group.", confirmText: "Leave", tone: "danger" });
    if (!ok) return;
    if (await patch({ action: "leave" })) onLeft();
  };

  const nameChanged = Boolean(info) && name.trim() !== "" && name.trim() !== info?.title;

  return (
    <>
      {createPortal(
        <div className="fixed inset-0 z-[10100] flex items-end justify-center bg-[#2D1D16]/60 backdrop-blur-sm sm:items-center sm:p-5" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
          <section role="dialog" aria-modal="true" aria-label="Group info" className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-[30px] border border-[#EBDCD1] bg-[#FFFCF9] p-5 text-[#30241f] shadow-2xl sm:rounded-[30px] sm:p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-black">Group info</h2>
              <button type="button" onClick={onClose} aria-label="Close" className="rounded-full bg-[#F4E7DE] p-2 text-[#80533E]"><X size={18} /></button>
            </div>

            {!info ? (
              <p className="py-10 text-center text-sm text-[#9c8173]">{error || "Loading…"}</p>
            ) : (
              <>
                {/* Photo + name */}
                <div className="mt-5 flex flex-col items-center text-center">
                  <div className="relative">
                    <Avatar src={info.photoUrl} name={info.title} size="h-24 w-24 text-3xl" />
                    {isAdmin && (
                      <>
                        <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => void changePhoto(e.target.files?.[0])} />
                        <button type="button" aria-label="Change group photo" disabled={uploading} onClick={() => photoInput.current?.click()} className="absolute -bottom-2 -right-2 grid h-9 w-9 place-items-center rounded-full border-[3px] border-[#FFFCF9] bg-gradient-to-br from-[#D39472] to-[#994D35] text-white disabled:opacity-60">
                          {uploading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/50 border-t-white" /> : <Camera size={16} />}
                        </button>
                      </>
                    )}
                  </div>
                  {isAdmin ? (
                    <div className="mt-4 flex w-full max-w-xs items-center gap-2">
                      <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className="min-w-0 flex-1 rounded-xl border border-[#E6D5C9] bg-white px-3 py-2 text-center text-sm font-bold outline-none focus:border-[#B87556]" />
                      {nameChanged && <button type="button" disabled={busy} onClick={() => void patch({ action: "rename", title: name.trim() })} className={pill}>Save</button>}
                    </div>
                  ) : <h3 className="mt-4 text-lg font-black">{info.title}</h3>}
                  <p className="mt-1 text-xs text-[#927c70]">Group · {members.length}/{MAX_MEMBERS} members</p>
                </div>

                {/* Members */}
                <div className="mt-6 flex items-center justify-between">
                  <h3 className="text-sm font-bold">Members</h3>
                  <button type="button" onClick={() => setAdding((v) => !v)} disabled={room <= 0} className={`${pill} flex items-center gap-1`}><Plus size={14} /> {adding ? "Cancel" : "Add members"}</button>
                </div>

                {adding && (
                  <div className="mt-3 rounded-2xl border border-[#EBDCD1] bg-white p-3">
                    {candidates.length === 0 ? (
                      <p className="py-3 text-center text-xs text-[#9c8173]">All your friends are already in this group.</p>
                    ) : (
                      <>
                        <div className="space-y-1">
                          {candidates.map((f) => (
                            <label key={f.userid} className="flex cursor-pointer items-center gap-3 rounded-xl p-2 hover:bg-[#fff0e7]">
                              <input type="checkbox" checked={selected.includes(f.userid)} disabled={!selected.includes(f.userid) && selected.length >= room} onChange={(e) => setSelected((old) => e.target.checked ? [...old, f.userid] : old.filter((id) => id !== f.userid))} />
                              <Avatar src={f.profileimage} name={f.username} size="h-9 w-9" />
                              <span className="truncate text-sm font-semibold">{f.username}</span>
                            </label>
                          ))}
                        </div>
                        <button type="button" disabled={busy || selected.length === 0} onClick={() => void addSelected()} className="mt-3 w-full rounded-xl bg-gradient-to-r from-[#c77e5d] to-[#98452f] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">
                          Add {selected.length || ""} {selected.length === 1 ? "member" : "members"}
                        </button>
                      </>
                    )}
                  </div>
                )}

                <ul className="mt-3 space-y-2">
                  {members.map((m) => {
                    const isFounder = m.userId === founderId;
                    const isMe = m.userId === meId;
                    const label = labelOf(m);
                    return (
                      <li key={m.userId} className="flex items-center gap-3 rounded-2xl border border-[#EBDCD1] bg-white p-3">
                        <Avatar src={m.person?.profileimage} name={label} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-bold">{label}{isMe && <span className="ml-1 font-normal text-[#9c8173]">(You)</span>}</p>
                          <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${m.role === "admin" ? "bg-[#fbe3d6] text-[#a4452c]" : "bg-[#f1ece8] text-[#7d6a5f]"}`}>
                            {m.role === "admin" ? (isFounder ? "Admin · Creator" : "Admin") : "Member"}
                          </span>
                        </div>
                        {isAdmin && !isFounder && (
                          <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row">
                            {m.role === "admin"
                              ? <button type="button" disabled={busy} onClick={() => void changeRole(m, "demote")} className={pill}>Remove admin</button>
                              : <button type="button" disabled={busy} onClick={() => void changeRole(m, "promote")} className={pill}>Make admin</button>}
                            {!isMe && <button type="button" disabled={busy} onClick={() => void removeMember(m)} className={`${pill} border-red-200 text-red-600`}>Remove</button>}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>

                {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}

                <button type="button" disabled={busy} onClick={() => void leave()} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-600 disabled:opacity-60">
                  <LogOut size={16} /> Leave group
                </button>
              </>
            )}
          </section>
        </div>,
        document.body,
      )}
      {dialog}
    </>
  );
}