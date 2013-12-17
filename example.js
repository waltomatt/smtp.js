var smtp = require("./smtp/init.js");

smtp.init({
    port: 25,
    server: "your.domain-name.com",
    debug: true
});

smtp.on("received", function(response) {
    var message = smtp.parseMessage(response.bodies); // Returns an object containing the message string and the type
    var attachments = smtp.parseAttachments(response.bodies); // Returns an array containins attachment objects

    console.log(response.headers); // Headers contain info such as sent address, dates, etc
    console.log(message);
    console.log(attachments);
});