require('dotenv').config();

const express = require('express');
const axios = require('axios');
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
	host: process.env.MYRMD_HOST,
	user: process.env.MYRMD_USER,
	password: process.env.MYRMD_PASSWORD,
	database: process.env.MYRMD_DBNAME
});

const teleapi = axios.create({
	baseURL: `https://api.telegram.org/bot${process.env.MYRMD_TELEKEY}/`,
	headers: {
		'Content-Type': 'application/json'
	}
});
const app = express();
const session = { stage: 'menu' };

app.use(express.json());

app.post('/bot', async (req, res) => {
	await stages[session.stage](req.body);
	
	res.header('Content-Type', 'text/html');
	res.status(200).end();
});

const stages = {
	'menu': menuStage,
	'newhabit': newhabitStage
};

function getSender(update) {
	return update.message.from;
}

function getMessageText(update) {
	return update.message.text;
}

async function sendMessage(chatId, msg) {
	await teleapi.post('/sendMessage', {
		chat_id: chatId,
		text: msg
	});
}

async function menuStage(update) {
	const txt = getMessageText(update);
	const conn = pool.promise();
	
	if (txt == "/start") {
		await sendMessage(
			getSender(update).id,
			"Hello! you can start by using /newhabit\n" +
			"and list your habits using /habits command."
		);
	}

	if (txt == "/habits") {
		let [habits] = await conn.query("SELECT id, activity FROM habits ORDER BY id");
		await sendMessage(
			getSender(update).id,
			"Habits\n\n" +
			habits.map(h => `${h.id} - ${h.activity}`).join('\n')
		);
	}

	if (txt == "/newhabit") {
		session.stage = "newhabit";
		await sendMessage(
			getSender(update).id,
			"What is the name of the activity?"
		);
	}
}

async function newhabitStage(update) {
	await sendMessage(
		getSender(update).id,
		"That is very good! Habit added to list.\n" +
		"Type /newhabit to add more and /habits to list all of yours."
	);
	session.stage = 'menu';
}

app.listen(process.env.MYRMD_NET_PORT || 8080, () => {
	console.log("[i] Ran at", process.env.MYRMD_NET_PORT || 8080);
});
