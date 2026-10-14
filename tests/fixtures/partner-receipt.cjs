function receiptData(session) {
  const free=session.amount_total===0;
  const subtotal=free?180000:120000;
  const details=session.total_details||{amount_discount:subtotal-(free?0:30000),amount_tax:0,amount_shipping:0};
  return {
    account:{id:'acct_example',company:{name:'Eventland LLC',address:{line1:'Example office',city:'Jersey City',state:'NJ',postal_code:'00000',country:'US'}},business_profile:{support_email:'support@example.test'}},
    session:{...session,created:1791982800,amount_subtotal:session.amount_subtotal??subtotal,total_details:details,line_items:{data:[{description:free?'Strategic Founding Partner participation':'Founding Partner participation'}]},customer_details:{...session.customer_details,name:'Monti Example',business_name:'Montclair Cafe',address:{city:'Montclair',state:'NJ',country:'US'}},
      payment_intent:free?null:{id:typeof session.payment_intent==='string'?session.payment_intent:'pi_example',status:'succeeded',latest_charge:{id:'ch_example',created:1791982800,paid:true,amount:session.amount_total,currency:'usd',receipt_number:'example-1234',receipt_url:'https://pay.stripe.com/receipts/example',payment_method_details:{type:'card',card:{brand:'visa',last4:'4242'}}}}},
  };
}
const session={id:'cs_live_example_receipt',client_reference_id:'example',mode:'payment',status:'complete',livemode:true,currency:'usd',amount_total:32000,amount_subtotal:120000,total_details:{amount_discount:90000,amount_tax:2000,amount_shipping:0},automatic_tax:{enabled:true,status:'complete'},payment_status:'paid',payment_intent:'pi_example',customer_details:{email:'payer@example.test'}};
module.exports={receiptData,session};
