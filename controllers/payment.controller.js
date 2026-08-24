const stripeService = require('../services/stripe.service');

async function createSubscription(req, res) {
    try {
        const url = await stripeService.createCheckoutSession({ email: req.user.email });

        return res.json({
            success: true,
            checkout_url: url,
        });

    } catch (error) {
        console.log(error.message);

        return res.status(500).json({
            success: false,
            message: 'Error creating checkout session',
        });
    }
}

module.exports = {
    createSubscription,
};
