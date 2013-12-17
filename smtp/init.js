var smtp = {};

var net = require("net"),
    fs = require("fs"),
    colors = require("colors");
    commands = require("./commands.js");

smtp.config = {};

smtp.sessions = [];
smtp.events = [];
smtp.checks = [];
smtp.commands = require("./commands.js");

smtp.terminator = "\r\n.\r\n";

// Console debug functions (will be replaced with my error handler later)

smtp.debug = function(message, id) {
    if (!smtp.config.debug)
        return;

    if (id != undefined) {
        message = "(" + id + ") " + message;
    }

    console.log("[smtp] [debug]: ".grey + message.white);
}

smtp.message = function(text) {
    console.log("[smtp]".grey + " [message]: ".green + text.white);
}

smtp.error = function(message) {
    console.log("[smtp]".grey + " [error]: ".red + message.white);
}


// Utility functions

smtp.validateEmail = function(email) {
    return (email.indexOf("@") > 0);
}

smtp.checkShould = function(check, params) {
    if (smtp.checks[check]) {
        var shouldDo = true;

        for (i=0; i<smtp.checks[check].length; i++) {
            if (smtp.checks[check][i] && (smtp.checks[check][i](params) == false)) {
                shouldDo = false;
            }
        }

        return shouldDo;

    } else {
        return true;
    }
}

smtp.runOn = function(evnt, params) {
    if (smtp.events[evnt]) {
        for (i=0; i<smtp.events[evnt].length; i++) {
            smtp.events[evnt][i](params);
        }
    }
}

smtp.start = function() {
    smtp.debug("Starting up SMTP TCP server on port " + smtp.config.port);

    smtp.server = net.createServer(function(socket) {

        if (!smtp.checkShould("connect", socket.remoteAddress)) {
            smtp.end(socket, 551, "IP blocked");
            return;
        }

        smtp.debug("New connection from " + socket.remoteAddress)

        socket.id = smtp.sessions.length;
        smtp.sessions[socket.id] = {authed: false};

        smtp.response(socket, 220, smtp.config.server + " ESMTP MattMail");

        socket.on("data", function(data) {
            smtp.handler(socket, data);
        });

        socket.on("end", function() {
            var id = socket.id;
            if ((id != undefined) && smtp.sessions[id]) {
                smtp.sessions[id] = false;
                smtp.debug("closed connection", id);
            }
        });

    }).listen(smtp.config.port, function() {
        smtp.message("Successfully bound SMTP server to port " + smtp.config.port);
    });
}

smtp.handler = function(socket, data) {
    data = data.toString();

    if (data) {

        if (smtp.sessions[socket.id].receivingData && smtp.authed(socket)) {
            smtp.data(socket, data);

        } else {

            data = data.replace("\r\n", "").split(" ");

            if (data.length > 0) {
                var cmd = data[0].toUpperCase();
                data.splice(0, 1);

                if ((cmd != "HELO" && cmd != "EHLO") && !smtp.authed(socket)) {
                    smtp.response(socket, 530, "haven't said hello yet");

                } else {
                    smtp.commands.handler(smtp, cmd, data, socket);
                }
            }
        }
    }
}

smtp.authed = function(socket) {
    return (smtp.sessions[socket.id] && smtp.sessions[socket.id].authed);
}

smtp.response = function(socket, code, message) {
    socket.write(code + " " + message + "\r\n");
}

smtp.end = function(socket, code, message) {
    socket.end(code + " " + message + "\r\n");
}

smtp.data = function(socket, data) {
    if (data.substr(data.length - smtp.terminator.length) == smtp.terminator) {
        smtp.sessions[socket.id].data += data.substr(0, data.length - smtp.terminator.length);
        smtp.sessions[socket.id].receivingData = false;

        smtp.debug("received all data", socket.id);
        smtp.message("Succcessfully received email from " + smtp.sessions[socket.id].from);
        smtp.add(smtp.sessions[socket.id]);

        smtp.response(socket, 250, "Ok: queued as " + socket.id);

    } else {
        smtp.sessions[socket.id].data += data;
    }
}

smtp.handleEmailData = function(data, callback) {
    data = data.split("\t");

    var splitHeader = data[0].split("\r\n");
    var headers = [];

    for (i=0; i<splitHeader.length; i++) {
        var key = splitHeader[i].split(" ")[0];

        if (key != "") {
            key = key.substr(0, key.length-1).toLowerCase();

            var value = splitHeader[i].substr(key.length + 2, splitHeader[i].length);

            headers[key] = value;
        }
    }

    if (!smtp.checkShould("setheaders", headers))
        return;

    var boundaryData = data[1].split("\r\n")[0].split("=\"");
    var boundary = "";

    if (boundaryData[0].toLowerCase() == "boundary") {
        boundary = "--" + boundaryData[1].substr(0, boundaryData[1].length-1);
    }

    var bodyBlocks = [];
    var splitBody = data[1].split("\r\n");
    var messageString = "";
    var messageCapturing = false;

    for (i=0; i<splitBody.length; i++) {
        if (splitBody[i] == boundary) {
            if (messageCapturing) {
                bodyBlocks.push(messageString);
                messageString = "";

            } else {
                messageCapturing = true;
            }

        } else if (splitBody[i] == boundary + "--") {
            bodyBlocks.push(messageString);
            messageCapturing = false;

        } else if (messageCapturing) {
            messageString += (splitBody[i] + "\r\n")
        }
    }


    var messageBlocks = [];

    for (i=0; i<bodyBlocks.length; i++) {
        var message = {};
        message.headers = [];

        var bodyContent = bodyBlocks[i].split("\r\n\r\n");

        var body = bodyContent[0].split("\r\n");
        for (x=0; x<body.length; x++) {
            var k = body[x].split(": ")[0].toLowerCase();
            message.headers[k] = body[x].split(": ")[1].toLowerCase().split("; ");
        }

        bodyContent.splice(0, 1);

        message.data = bodyContent.join("\r\n");
        message.data.substr(0, message.data.length -4);

        messageBlocks.push(message);
    }

    callback(headers, messageBlocks);
}

smtp.add = function(data) {
    smtp.runOn("raw", {data: data});

    try {
        smtp.handleEmailData(data.data, function(headers, messages) {
            smtp.runOn("received", {headers: headers, bodies: messages, from: data.from, recipients: data.recipients, domain: data.domain});
        });

    } catch(err) {
        if (err) {
            smtp.runOn("error", err);
        }
    }
}

exports.init = function(conf) {
    if (!conf || !conf.port || !conf.server) {
        error("Not enough config parameters (must have port and server address)");
        return false;

    } else {
        smtp.config = conf;
        smtp.start()
    }
}

exports.on = function(evnt, callback) {
    if (!smtp.events[evnt])
        smtp.events[evnt] = [];

    smtp.events[evnt].push(callback);
}

exports.should = function(check, callback) {
    if (!smtp.checks[check])
        smtp.checks[check] = [];

    smtp.checks[check].push(callback);
}

exports.parseMessage = function(data) {
    var message = "";
    var html = false;

    for (i=0; i<data.length; i++) {
        if (data[i] && data[i].headers && data[i].headers['content-type'] && data[i].data) {
            var type = data[i].headers['content-type'];

            if (type.indexOf("text/html") != -1)
                html = true;

            if ((type.indexOf("text/plain") != -1 || type.indexOf("text/html") != -1) && (!data[i].headers['content-disposition'] || data.headers['content-disposition'] == -1)) {
                message += data[i].data;
            }
        }
    }

    return {html: html, message: message};
}

exports.parseAttachments = function(data) {
    var attachments = [];

    for (i=0; i<data.length; i++) {
        if (data[i] && data[i].headers && data[i].headers['content-disposition'] && data[i].data) {
            var head = data[i].headers;

            if (head['content-disposition'].indexOf("attachment") != -1) {
                var name = "unknown.txt";
                var type = "application/octet-stream"; // Maybe todo -> grab mime type later on

                for (x=0; x<head['content-disposition'].length; x++) {
                    if (head['content-disposition'][x].indexOf("filename=") != -1) {
                        name = head['content-disposition'][x].split("filename=")[1];
                        break;
                    }
                }

                var fileData = data[i].data;

                if (head['content-transfer-encoding'] && head['content-transfer-encoding'][0] && head['content-transfer-encoding'][0] == "base64") {
                    fileData = new Buffer(data[i].data, "base64")
                }

                attachments.push({name: name, type: type, data: fileData});
            }
        }
    }

    return attachments;
}