const nodemailer = require('nodemailer');
const { smtp, doctorEmail } = require('./config');

const transport = smtp.host
  ? nodemailer.createTransport({
      host: smtp.host,
      port: Number(smtp.port),
      secure: Number(smtp.port) === 465,
      auth: { user: smtp.user, pass: smtp.pass },
    })
  : null;

// Never throws: data is already saved in the database before email is attempted.
async function send({ to, subject, text, replyTo }) {
  if (!transport || !to) {
    console.log(`[email not sent] To: ${to || '(none)'}\nSubject: ${subject}\n${text}\n`);
    return false;
  }
  try {
    await transport.sendMail({ from: smtp.from || smtp.user, to, replyTo, subject, text });
    return true;
  } catch (err) {
    console.error('Mail failed:', err.message);
    return false;
  }
}

const sendToDoctor = (mail) => send({ ...mail, to: doctorEmail });
const sendToCustomer = (mail) => send(mail);

module.exports = { sendToDoctor, sendToCustomer };
