import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useOutletContext } from "react-router";
import type { AdminContext } from "./layout";
import { errorText, when } from "~/features/admin/shared";
import { api } from "~/lib/http";

interface Staff {
  id: string;
  email: string;
  fullName: string;
  role: "ADMIN" | "OWNER";
  status: "ACTIVE" | "DISABLED";
  lastLoginAt?: string;
  you: boolean;
}

const label = "mb-1 block text-xs font-medium";

function StaffRow({ person }: { person: Staff }) {
  const client = useQueryClient();
  const [mode, setMode] = useState<"idle" | "confirm" | "password">("idle");
  const [password, setPassword] = useState("");
  const refresh = () => client.invalidateQueries({ queryKey: ["admin", "staff"] });
  const active = person.status === "ACTIVE";

  const setStatus = useMutation({
    mutationFn: () => api("POST", `/api/v1/admin/staff/${person.id}/status`, { status: active ? "DISABLED" : "ACTIVE" }),
    onSuccess: () => {
      setMode("idle");
      refresh();
    },
  });
  const reset = useMutation({
    mutationFn: () => api("POST", `/api/v1/admin/staff/${person.id}/password`, { password }),
    onSuccess: () => {
      setMode("idle");
      setPassword("");
    },
  });
  const failure = setStatus.error ?? reset.error;

  return (
    <li className={`border bg-card p-4 text-sm ${active ? "border-line" : "border-line opacity-70"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold">
            {person.fullName} {person.you && <span className="font-normal text-stone">(you)</span>}
          </p>
          <p className="break-all text-stone">{person.email}</p>
          <p className="text-xs text-stone">
            {person.role === "OWNER" ? "Owner: everything" : "Admin: daily work, no payment settings, staff or policy publishing"}
            {" · "}
            {active ? "Can sign in" : "Switched off"}
            {" · "}
            {person.lastLoginAt ? `last signed in ${when(person.lastLoginAt)}` : "never signed in"}
          </p>
        </div>
        {!person.you && mode === "idle" && (
          <div className="flex gap-2">
            <button type="button" className="btn btn-outline" onClick={() => setMode("password")}>Set new password</button>
            <button type="button" className="btn btn-outline" onClick={() => (active ? setMode("confirm") : setStatus.mutate())} disabled={setStatus.isPending}>
              {active ? "Switch off" : "Switch on"}
            </button>
          </div>
        )}
      </div>

      {mode === "confirm" && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
          <p className="font-semibold">Switch off {person.fullName}? They are signed out at once and cannot sign in.</p>
          <div className="flex gap-2">
            <button type="button" className="btn btn-outline" onClick={() => setMode("idle")}>Back</button>
            <button type="button" className="btn btn-primary" disabled={setStatus.isPending} onClick={() => setStatus.mutate()}>Yes, switch off</button>
          </div>
        </div>
      )}
      {mode === "password" && (
        <form
          className="mt-3 flex flex-wrap items-end gap-3 border-t border-line pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (password.length >= 12) reset.mutate();
          }}
        >
          <div>
            <label htmlFor={`pw-${person.id}`} className={label}>New password for {person.fullName} (12+ characters)</label>
            <input id={`pw-${person.id}`} type="password" autoComplete="new-password" className="field w-72" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <button type="submit" className="btn btn-primary" disabled={password.length < 12 || reset.isPending}>Save password</button>
          <button type="button" className="btn btn-outline" onClick={() => setMode("idle")}>Back</button>
          <p className="w-full text-xs text-stone">They are signed out everywhere. Give them the new password in person, and ask them to change it.</p>
        </form>
      )}
      {reset.isSuccess && mode === "idle" && <p role="status" className="mt-2">Password changed.</p>}
      {failure && <p role="alert" className="mt-2 text-danger">{errorText(failure)}</p>}
    </li>
  );
}

/** Owner only. The server refuses these calls from anyone else; the screen just says so plainly. */
export default function AdminStaff() {
  const { isOwner } = useOutletContext<AdminContext>();
  const client = useQueryClient();
  const staff = useQuery({
    queryKey: ["admin", "staff"],
    queryFn: () => api<Staff[]>("GET", "/api/v1/admin/staff"),
    enabled: isOwner,
  });
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"ADMIN" | "OWNER">("ADMIN");
  const [password, setPassword] = useState("");
  const create = useMutation({
    mutationFn: () => api("POST", "/api/v1/admin/staff", { fullName, email, role, password }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["admin", "staff"] });
      setFullName(""); setEmail(""); setPassword(""); setRole("ADMIN");
    },
  });

  if (!isOwner) {
    return (
      <div className="max-w-2xl">
        <h1 className="display text-2xl">Staff</h1>
        <p className="mt-4 border border-line bg-card p-4 text-sm">Only the owner can add or switch off staff accounts.</p>
      </div>
    );
  }
  const ready = fullName.trim().length >= 2 && /^\S+@\S+\.\S+$/.test(email) && password.length >= 12;

  return (
    <div className="max-w-3xl">
      <h1 className="display text-2xl">Staff</h1>
      <p className="mt-2 text-sm text-stone">
        Everyone who can open this dashboard. Each person has their own account, so the history shows who did what.
      </p>

      <ul className="mt-6 space-y-3" aria-busy={staff.isFetching}>
        {staff.data?.map((person) => <StaffRow key={person.id} person={person} />)}
      </ul>
      {staff.isPending && <p className="mt-6 text-sm text-stone">Loading…</p>}
      {staff.isError && <p className="mt-6 text-sm text-danger" role="alert">Could not load staff.</p>}

      <form
        className="mt-8 border border-line bg-card p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) create.mutate();
        }}
      >
        <h2 className="font-semibold">Add a staff member</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="staff-name" className={label}>Full name</label>
            <input id="staff-name" className="field" maxLength={120} value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div>
            <label htmlFor="staff-email" className={label}>Email they will sign in with</label>
            <input id="staff-email" type="email" className="field" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label htmlFor="staff-role" className={label}>What they can do</label>
            <select id="staff-role" className="field" value={role} onChange={(e) => setRole(e.target.value as "ADMIN" | "OWNER")}>
              <option value="ADMIN">Admin: orders, transfers, products, stock, offers, delivery fees, drafts</option>
              <option value="OWNER">Owner: everything, including payment settings, staff, refunds and publishing policies</option>
            </select>
          </div>
          <div>
            <label htmlFor="staff-password" className={label}>First password (12+ characters)</label>
            <input id="staff-password" type="password" autoComplete="new-password" className="field" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="submit" className="btn btn-primary" disabled={!ready || create.isPending}>
            {create.isPending ? "Saving…" : "Add staff member"}
          </button>
          {create.isSuccess && <span role="status" className="text-sm">Added. Give them the password in person and ask them to change it.</span>}
          {create.isError && <span role="alert" className="text-sm text-danger">{errorText(create.error)}</span>}
        </div>
      </form>
    </div>
  );
}
