import rp from "request-promise";
import WebSocket from "ws";
import vm from "vm";
import EventEmitter from "events";
import log from "./log";

export default class Bot extends EventEmitter
{
	commands = new EventEmitter();

	constructor(username, password)
	{
		super();
		this.username = username;
		this.password = password;
	}

	async login()
	{
		log.info(`Logging in as ${this.username}...`);
		// post the login endpoint, to get the needed session and modhash
		let body = await rp({
			method: "POST",
			uri: `https://www.reddit.com/api/login/${this.username}`,
			form: {
				op: "login",
				user: this.username,
				passwd: this.password,
				api_type: "json"
			},
			json: true
		});
		this.session = body.json.data.cookie;
		this.modhash = body.json.data.modhash;
		log.info("Logged in. Session and mod hash retrieved.");
	}

	async retrieveSetup()
	{
		log.info("Retrieving setup information...");
		let data = await rp({
			uri: "https://www.reddit.com/robin",
			headers: {cookie: `reddit_session=${this.session}`},
			resolveWithFullResponse: true
		}).then(res => {
			// if user is not in a room, join one
			if (res.request.uri.pathname === "/robin/join")
			{
				log.info("User is not in a room, joining one...");
				return rp({
					method: "POST",
					uri: `https://www.reddit.com/api/join_room`,
					headers: {
						cookie: `reddit_session=${this.session}`,
						"x-modhash": this.modhash
					}
				}).then(() => {
					// resend the request for setup info
					return rp({
						uri: "https://www.reddit.com/robin",
						headers: {cookie: `reddit_session=${this.session}`}
					});
				});;
			}
			// else just pass on the body
			else return res.body;
		});

		// extract the json from setup. includes ws url, etc.
		// need to re-add brackets because regex removes them
		let setup = `{${/r\.setup\({(.*?)}\)/.exec(data)[1]}}`;
		this.setup = JSON.parse(setup);
	}

	connect()
	{
		log.info("Connecting to room...");
		// connect to the websocket to receive messages
		this.ws = new WebSocket(this.setup.robin_websocket_url);
		// setup our listeners
		this.ws.on("open", () => log.info(`Connected to ${this.setup.robin_room_name.substr(0, 50)}...`));
		// pass events onto the bot listeners
		this.ws.on("message", async json => {
			let data = JSON.parse(json);
			// if it's a merge, reinit
			if (data.type === "merge")
			{
				log.info("Room is merging...");
				this.ws.close();
				await this.retrieveSetup();
				this.connect();
			}
			// if it's a command (e.g !dice)
			else if (data.type === "chat"
				&& data.payload.body.startsWith("!"))
			{
				let cmd = data.payload.body.split(" ");
				// command name without ! (e.g dice), command params, user
				this.commands.emit(cmd.shift().replace("!", ""), cmd, data.payload.from);
			}
			// else just pass it on to listeners
			else this.emit(data.type, data.payload);
		});
	}

	async init()
	{
		log.info("Initalizing bot...");
		await this.login();
		await this.retrieveSetup();
		this.connect();
	}

	send(message)
	{
		return rp({
			method: "POST",
			uri: `https://www.reddit.com/api/robin/${this.setup.robin_room_id}/message`,
			form: {
				message: message,
				room_id: this.setup.robin_room_id,
				api_type: "json"
			},
			headers: {
				cookie: `reddit_session=${this.session}`,
				"x-modhash": this.modhash
			}
		});
	}

	sendMe(message)
	{
		return send(`/me ${message}`);
	}

	vote(type)
	{
		return rp({
			method: "POST",
			uri: `https://www.reddit.com/api/robin/${this.setup.robin_room_id}/vote`,
			form: {
				vote: type,
				room_id: this.setup.robin_room_id,
				api_type: "json"
			},
			headers: {
				cookie: `reddit_session=${this.session}`,
				"x-modhash": this.modhash
			}
		});
	}
};
