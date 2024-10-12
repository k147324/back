const express = require("express");
const WebSocket = require("ws");
const bodyParser = require("body-parser");
const mysql = require("mysql2");

const http = require("http");
const cors = require("cors");
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
app.use(bodyParser.json());
app.use(cors());
const generateRandomId = () => {
  return Math.random().toString(36).substr(2, 8);
};
const db = mysql.createConnection({
  host: "database-1.c1ao4wk8cpt2.ap-southeast-2.rds.amazonaws.com",
  user: "admin",
  password: "12345678",
  database: "new_schema",
});
db.connect((err) => {
  if (err) {
    console.error("Error connecting to the database:", err);
    return;
  }
  console.log("Connected to the database");
});
//data
const studentList = [];
const clients = {
  py: [],
  web: [],
};

//api
app.post("/register", (req, res) => {
  const { username, password } = req.body;
  const userId = generateRandomId();
  const query = "INSERT INTO user_info(id,username,password) VALUES (?,?,?)";
  db.query(query, [userId, username, password], (err, results) => {
    if (err) {
      return res.status(500).json({ error: "Database Error" });
    }
    return res.status(200).json({ message: "User registered successfully" });
  });
});
app.post("/login", (req, res) => {
  const { username, password } = req.body;
  console.log(req.body);
  const query = "SELECT * FROM user_info WHERE username = ? ";
  db.query(query, [username], (err, results) => {
    if (err) {
      return res.status(500).json({ error: "Database error" });
    }
    if (results.length === 0) {
      return res.status(401).json({ error: "Invalid username or password" });
    }
    const user = results[0];
    if (password === user.password) {
      console.log("Login success");
      return res
        .status(200)
        .json({ message: "Login success", userId: user.id });
    } else {
      return res.status(401).json({ error: "Invalid username or password" });
    }
  });
});
//websocket
wss.on("connection", (ws) => {
  console.log("WebSocket connected");

  ws.on("message", (message) => {
    console.log(`Received:${message}`);
    let parsedMessage;
    try {
      parsedMessage = JSON.parse(message);
    } catch (e) {
      console.error("Invalid JSON message received");
      return;
    }
    if (parsedMessage.type === "identify") {
      if (parsedMessage.client === "python") {
        clients.py.push({ ws, student: parsedMessage.data });
        studentList.push(parsedMessage.data);
        console.log(studentList);
        broadcastStudentList();
      } else if (parsedMessage.client === "web") {
        clients.web.push(ws);
        console.log("Web client connected");
        broadcastStudentList();
      }
    } else if (parsedMessage.type === "notification") {
      clients.web.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          console.log(parsedMessage.data);
          broadcastCheatingNotification(parsedMessage);
        }
      });
    } else if (
      parsedMessage.type === "start_detection" ||
      parsedMessage.type === "stop_detection"
    ) {
      const data = {
        type: parsedMessage.type,
        time: parsedMessage.data,
      };
      clients.py.forEach((client) => {
        client.ws.send(JSON.stringify(data));
        console.log("Message send to py");
      });
    } else if (parsedMessage.type === "Record_request") {
      const query = "SELECT * FROM notice_record WHERE user_id =?";
      db.query(query, [parsedMessage.data], (err, results) => {
        clients.web.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(
              JSON.stringify({
                type: "record",
                data: results,
              })
            );
          }
        });
        console.log(results);
      });
    } else if (parsedMessage.type === "Clear_request") {
      const query = "DELETE FROM notice_record WHERE user_id=?";
      db.query(query, [parsedMessage.data], (err, res) => {
        clients.web.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(
              JSON.stringify({
                type: "record",
                data: res,
              })
            );
          }
        });
      });
    } else if (parsedMessage.type === "student_request") {
      broadcastStudentList();
    }
  });

  ws.on("close", () => {
    clients.py = clients.py.filter((client) => {
      if (client.ws === ws) {
        const studentIndex = studentList.indexOf(client.student);
        if (studentIndex > -1) {
          studentList.splice(studentIndex, 1);
          console.log(`Removed student: ${client.student}`);
        }
        return false;
      }
      return true;
    });

    const indexWeb = clients.web.indexOf(ws);
    if (indexWeb > -1) {
      clients.web.splice(indexWeb, 1);
      console.log(`Web client disconnected`);
    }
  });

  const broadcastStudentList = () => {
    clients.web.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: "studentData", data: studentList }));
        console.log("Student data sent");
      }
    });
  };
  const broadcastCheatingNotification = (data) => {
    const now = new Date();
    const localDateTime = now.toLocaleString();
    console.log(localDateTime);
    const query =
      "INSERT INTO notice_record(notice_id,user_id,notice_info,time) VALUES(?,?,?,?)";
    db.query(query, [generateRandomId(), data.user, data.data, localDateTime]);
    const notification = {
      type: "notification",
      data: data.data,
    };
    clients.web.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(notification));
      }
    });
  };
});

const port = 3000;
server.listen(port, () => {
  console.log(`Server is running on http://54.252.113.192:${port}`);
});
