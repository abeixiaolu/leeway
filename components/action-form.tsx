"use client";

import { useActionState, useRef } from "react";

type Result = { ok: true } | { ok: false; error: string };

export function ActionForm({ action, children, className }: {
  action: (formData: FormData) => Promise<Result>;
  children: React.ReactNode;
  className?: string;
}) {
  const requestId = useRef<string | null>(null);
  const [error, submit, pending] = useActionState(async (_previous: string, formData: FormData) => {
    try {
      requestId.current ??= crypto.randomUUID();
      formData.set("requestId", requestId.current);
      const result = await action(formData);
      if (result.ok) requestId.current = null;
      return result.ok ? "" : result.error;
    } catch {
      return "操作失败，请稍后重试。";
    }
  }, "");

  return <form action={submit} className={className}><fieldset className="action-fieldset" disabled={pending}>{children}</fieldset>{error && <p className="form-error" role="alert">{error}</p>}</form>;
}
