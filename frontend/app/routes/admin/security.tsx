import { TwoFactorPanel } from "~/features/admin/two-factor";

/** The signed-in staff member's own two-step sign-in: recovery codes left, and new ones. */
export default function AdminSecurity() {
  return (
    <div className="max-w-2xl">
      <h1 className="display text-2xl">Two-step sign-in</h1>
      <TwoFactorPanel />
    </div>
  );
}
