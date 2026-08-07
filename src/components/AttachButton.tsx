"use client";

import { useRef, useState } from "react";

/**
 * Shared photo/file picker: reads the file to base64 for upload, validates
 * type + size, and hands back a PickedFile. Images include a preview URL.
 */

export interface PickedFile {
  name: string;
  type: string;
  dataBase64: string;
  size: number;
  preview: string; // object URL for images, "" otherwise
}

export const MAX_ATTACH_BYTES = 3_500_000; // stays inside Netlify's request cap

const ALLOWED =
  /^(image\/|application\/pdf$|text\/(plain|csv)$|audio\/|video\/mp4$|application\/(msword|vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet)|vnd\.ms-excel)$)/;

export function allowedAttachment(type: string): boolean {
  return ALLOWED.test((type || "").toLowerCase());
}

export function AttachButton({
  onPick,
  disabled,
  label = "📎 Photo / file",
  multiple = false,
  onError,
}: {
  onPick: (f: PickedFile) => void;
  disabled?: boolean;
  label?: string;
  multiple?: boolean;
  onError?: (msg: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  function readOne(file: File): Promise<void> {
    return new Promise((resolve) => {
      if (!allowedAttachment(file.type)) {
        onError?.(`"${file.name}" isn't a supported type (photos, PDFs, docs, audio, or video)`);
        return resolve();
      }
      if (file.size > MAX_ATTACH_BYTES) {
        onError?.(`"${file.name}" is too large — keep attachments under 3.5 MB`);
        return resolve();
      }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result || "");
        const dataBase64 = dataUrl.split(",")[1] || "";
        onPick({
          name: file.name,
          type: file.type,
          dataBase64,
          size: file.size,
          preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : "",
        });
        resolve();
      };
      reader.onerror = () => resolve();
      reader.readAsDataURL(file);
    });
  }

  return (
    <>
      <button
        type="button"
        className="btn small ghost"
        disabled={disabled || busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? "Reading…" : label}
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple={multiple}
        accept="image/*,.pdf,.txt,.csv,.doc,.docx,.xls,.xlsx,audio/*,video/mp4"
        style={{ display: "none" }}
        onChange={async (e) => {
          const files = Array.from(e.target.files || []);
          if (!files.length) return;
          setBusy(true);
          for (const f of files) await readOne(f);
          setBusy(false);
          e.target.value = "";
        }}
      />
    </>
  );
}
