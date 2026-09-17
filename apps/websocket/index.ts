import { db } from "db/client";

Bun.serve({
    port: 8081,
    fetch(req, server) {
      // upgrade the request to a WebSocket
      if (server.upgrade(req)) {
        return; // do not return a Response
      }
      return new Response("Upgrade failed", { status: 500 });
    },
    websocket: {
        async message(ws, message) {

          const username = Math.random().toString();
          const password = Math.random().toString();
            await db.orm.public.User.create({
                    username,
                    password
            })
            ws.send(`Username : ${username} and Password : ${password}`);
        },
    },
});