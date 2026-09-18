"use client"
import { db } from "db/client";

export default async function Home() {
  const users = await db.orm.public.User.all();
  return (
    <div>
      {JSON.stringify(users)}
    </div>
  );
}

// export const revalidate = 60 // revalidate every 60 seconds
// or
// export const dynamic = 'force-dynamic'
