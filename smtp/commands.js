var commands = {};

commands["EHLO"] = function(smtp, cmd, data, socket) {
    if (data.length > 0) {
        var domain = data[0];

        smtp.sessions[socket.id].authed = true;
        smtp.sessions[socket.id].domain = domain;

        smtp.runOn("indentified", [socket.id, domain]);

        smtp.debug("identified as " + domain, socket.id);
        smtp.response(socket, 250, smtp.config.server + " Hello " + domain + " [" + socket.remoteAddress + "]");

    } else {
        smtp.response(socket, 501, cmd + " requires domain address");
    }
}

commands["HELO"] = commands["EHLO"];

commands["MAIL"] = function(smtp, cmd, data, socket) {
    if (data[0]) {
        data = data[0].split(":");

        if (data[0].toUpperCase() == "FROM") {
            if (data[1]) {

                var email = data[1].replace(/[<>]/g, "");

                if (smtp.validateEmail(email)) {
                    if (!smtp.checkShould("setfrom", email)) {
                        smtp.end(socket, 554, "From email not allowed");
                        return;
                    }

                    smtp.sessions[socket.id].from = email;
                    smtp.debug("from address set to " + email, socket.id);

                    smtp.response(socket, 250, "Ok");

                } else {
                    smtp.debug("invalid from address", socket.id);
                    smtp.resonse(socket, 501, cmd + " requires valid email");
                }

            } else {
                smtp.response(socket, 501, cmd + " requires email address");
            }

        } else {
            smtp.debug("Unknown mail handler (" + cmd + "): " + data[0], socket.id);
            smtp.response(socket, 250, "Ok");
        }

    } else {
        smtp.response(socket, 501, cmd + " requires type and address");
    }
}

commands["RCPT"] = function(smtp, cmd, data, socket) {
    if (data[0]) {
        data = data[0].split(":");

        if (data[0].toUpperCase() == "TO") {
            if (data[1]) {
                var email = data[1].replace(/[<>]/g, "");

                if (smtp.validateEmail(email)) {
                    if (!smtp.sessions[socket.id].recipients)
                        smtp.sessions[socket.id].recipients = [];

                    smtp.sessions[socket.id].recipients.push(email);
                    smtp.debug("added recipient <" + email + ">", socket.id);
                    smtp.response(socket, 250, "Ok");

                } else {
                    smtp.debug("invalid FROM address", socket.id);
                    smtp.response(socket, 501, cmd + " requires valid email");
                }

            } else {
                smtp.response(socket, 501, cmd + " requires email address");
            }

        } else {
            smtp.debug("Unknown mail handler (" + cmd + "): " + data[0], socket.id);
            smtp.response(socket, 250, "Ok");
        }

    } else {
        smtp.response(socket, 501, cmd + " requires type and address");
    }
}

commands["DATA"] = function(smtp, cmd, data, socket) {
    smtp.debug("starting to receive message body", socket.id);
    smtp.sessions[socket.id].data = "";
    smtp.sessions[socket.id].receivingData = true;

    smtp.response(socket, 354, "End data with <CR><LF>.<CR><LF>");
}

commands["RSET"] = function(smtp, type, data, socket) {
    smtp.sessions[socket.id] = false;
}

commands["QUIT"] = function(smtp, type, data, socket) {
    smtp.sessions[socket.id] = false;

    smtp.debug("finish", socket.id);
    smtp.end(socket, 221, "Transaction successful, thanks");
}

exports.handler = function(smtp, cmd, data, socket) {
    if (commands[cmd]) {
        commands[cmd](smtp, cmd, data, socket);

    } else {
        smtp.response(socket, 502, cmd + " not valid command");
    }
}