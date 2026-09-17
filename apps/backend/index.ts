import express from "express";
import { db } from "db/client";

const app = express();

app.use(express.json());

app.get("/users", async (req, res) => {
    const users = await db.orm.public.User.all();

    if (!users) res.status(404).json(users);

    res.status(200).json(users);
})

app.post("/user", (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        res.status(400).json({ error: "Username and password are required" });
        return;
    }

    // we also have to check if there are already username present or not
    // 

    db.orm.public.User.create({
        username,
        password
    }).then(user => {
        res.status(201).json(user);
    }).catch(err => {
            res.status(500).json({ error: err.message });
        });


})

app.listen(8080);