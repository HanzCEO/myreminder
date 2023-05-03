require('dotenv').config();

const express = require('express');
const axios = require('axios');
const mysql = require('mysql2');

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
const session = { stage: 'menu', chatId: 0 };

app.use(express.json());

app.get('/data', (req, res) => {
	res.json({time: new Date(), session});
});

app.get('/cron', async (req, res) => {
	const conn = pool.promise();

	const [reminders] = await conn.query(`
		SELECT r.*, h.activity FROM reminders r
			LEFT JOIN habits h ON h.id = r.target
	`);

	const retval = [];
	for (const rmd of reminders) {
		let [hour, minute, second] = rmd['hour'].split(':').map(Number);
		let lastUsed = new Date(rmd['last_used']);
		// let lastUsed = new Date(Number(rmd['last_used']));
		let perXday = Number(rmd['perXday']);

		if (Math.floor((Date.now() - lastUsed.getTime()) / (3600 * 24 * perXday)) > 0) {
			// Day >= 1
			// Check if time is now
			let dat = new Date();
			if ((hour - Number(process.env.MYRMD_TZ)) % 24 == dat.getHours() && minute == dat.getMinutes()) {
				await sendMessage(
					session.chatId,
					"Hey! Have you done this?\n" +
					rmd['activity'],

					{
						reply_markup: {
							inline_keyboard: [[
								{ text: 'Not yet', callback_data: `no-${rmd['id']}` },
								{ text: 'Yes', callback_data: `yes-${rmd['id']}` }
							]]
						}
					}
				);
				retval.push(rmd);
			}
		}
	}

	res.json({r:retval, r1: reminders, h: process.env.MYRMD_TZ});
});

app.post('/bot', async (req, res) => {
	session.chatId = getSender(req.body).id;
	await stages[session.stage](req.body);
	
	res.header('Content-Type', 'text/html');
	res.status(200).end();
});

const stages = {
	'menu': menuStage,
	'newhabit': newhabitStage,
	'setnewreminder': setnewreminderStage
};

function getSender(update) {
	return update.message?.from || update.callback_query?.from;
}

function getMessageText(update) {
	return update.message.text;
}

async function sendMessage(chatId, msg, opts) {
	await teleapi.post('/sendMessage', {
		chat_id: chatId,
		text: msg,
		...opts
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

	if (txt == "/remind") {
		session.stage = "setnewreminder";
		await sendMessage(
			getSender(update).id,
			"Send your habit ID:"
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
	await pool.promise().execute(
		"INSERT INTO habits (activity, date_added) VALUES (?, now())",
		[getMessageText(update)]
	);
}

async function setnewreminderStage(update) {
	let res = false;
	if (session.target === undefined) {
		res = await setnewreminderStage1(update);
	} else if (session.hours === undefined) {
		res = await setnewreminderStage2(update);
	} else if (session.perXday === undefined) {
		res = await setnewreminderStage3(update);
		if (res == false) return;
		
		await pool.promise().execute(
			"INSERT INTO reminders (target, hour, perXday) VALUES (?, ?, ?)",
			[session.target, session.hours, session.perXday]
		);
		await sendMessage(
			getSender(update).id,
			`Reminder for ${session.target} fully set ` +
			`at ${session.hours} each ${session.perXday} day.`
		);
		session = { stage: 'menu', chatId: session.chatId };
	}

	return res;
}

async function setnewreminderStage1(update) {
	if (isNaN(Number(getMessageText(update)))) {
		await sendMessage(
			getSender(update).id,
			"Habit ID invalid! Resend them."
		);
		return false;
	}

	let habitId = Number(getMessageText(update));
	let [rows] = await pool.promise().query(
		"SELECT activity FROM habits WHERE id=?", [habitId]
	);

	if (!(rows?.length)) {
		await sendMessage(
			getSender(update).id,
			"Habit ID not found! Resend them."
		);
		return false;
	}

	session.target = habitId;
	await sendMessage(
		getSender(update).id,
		"Target habit set. Now send your reminder hour:"
	);
	return true;
}

async function setnewreminderStage2(update) {
	let [hour, minute, second] = getMessageText(update)
					.split(':')
					.map(x => Number(x));
	second = second ?? 0;
	if (isNaN(hour) || isNaN(minute) || isNaN(second)) {
		await sendMessage(
			getSender(update).id,
			"Reminder hour format invalid! Resend them as HH:MM:SS."
		);
		return false;
	}

	const q = x => String(x).padStart(2, '0');
	session.hours = `${q(hour)}:${q(minute)}:${q(second)}`;
	await sendMessage(
		getSender(update).id,
		"Reminder hour set! Now set your day frequency:"
	);
	return true;
}

async function setnewreminderStage3(update) {
	let perXday = Number(getMessageText(update));

	if (isNaN(perXday)) {
		await sendMessage(
			getSender(update).id,
			"Reminder day invalid! Resend them as a number."
		);
		return false;
	}

	session.perXday = perXday;
	return true;
}

app.listen(process.env.MYRMD_NET_PORT || 8080, () => {
	console.log("[i] Ran at", process.env.MYRMD_NET_PORT || 8080);
});
