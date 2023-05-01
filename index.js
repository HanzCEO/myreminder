require('dotenv').config();

const express = require('express');
const axios = require('axios');
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
	host: process.env.MYRMD_HOST,
	user: process.env.MYRMD_USER,
	database: process.env.MYRMD_DBNAME
});

const teleapi = axios.create({
	baseURL: `https://api.telegram.org/bot${process.env.MYRMD_TELEKEY}/`,
	headers: {
		'Content-Type': 'application/json'
	}
});
const app = express();

app.post('/bot', async (req, res) => {
	await teleapi.post('/sendMessage', {
		chat_id: req.body.message.from.id,
		text: JSON.stringify(req.body, null, 4)
	});
	
	res.header('Content-Type', 'text/html');
	res.status(200).end();
});

app.listen(process.env.MYRMD_NET_PORT || 8080, () => {
	console.log("[i] Ran at", process.env.MYRMD_NET_PORT || 8080);
});
