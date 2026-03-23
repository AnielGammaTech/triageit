"use client";

import { MichaelChat } from "@/components/chat/michael-chat";

export default function MichaelPage() {
  // Negative margins to break out of the layout's max-w-7xl + padding container
  // so the chat fills the full viewport width below the header
  return (
    <div className="-m-4 sm:-m-6 lg:-m-8">
      <MichaelChat />
    </div>
  );
}
