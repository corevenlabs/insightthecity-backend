const axios = require('axios');

const woo = axios.create({
    baseURL: `${process.env.WC_URL}/wp-json/wc/v3`,
    auth: {
        username: process.env.WC_KEY,
        password: process.env.WC_SECRET,
    },
});

module.exports = woo;