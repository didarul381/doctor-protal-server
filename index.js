const express=require('express');
const cors=require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
// const { application } = require('express');
require('dotenv').config();
const stripe = require("stripe")(process.env.STRIPE_SECRET);

const port=process.env.PORT || 5000;
const app=express();

//middleware
app.use(cors());
app.use(express.json());




const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.bje6fgv.mongodb.net/?retryWrites=true&w=majority`;
console.log(uri)
console.log(process.env.ACCESS_TOKEN)
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });



function verifyJWT(req, res, next) {

    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send('unauthorized access');
    }

    const token = authHeader.split(' ')[1];

    jwt.verify(token, process.env.ACCESS_TOKEN, function (err, decoded) {
        if (err) {
            return res.status(403).send({ message: 'forbidden access' })
        }
        req.decoded = decoded;
        next();
    })

}






async function run(){
    try{

        const appointmentOptionCollection=client.db('doctorspotal').collection('appointmentOptions');
        const bookingsCollection=client.db('doctorspotal').collection(' bookingsCollection');
        const usersCollection=client.db('doctorspotal').collection(' users');
        const doctorsCollection=client.db('doctorspotal').collection('doctors');
        const paymentCollection=client.db('doctorspotal').collection('payments');

         // NOTE: make sure you use verifyAdmin after verifyJWT
         const verifyAdmin = async (req, res, next) =>{
            const decodedEmail = req.decoded.email;
            const query = { email: decodedEmail };
            const user = await usersCollection.findOne(query);

            if (user?.role !== 'admin') {
                return res.status(403).send({ message: 'forbidden access' })
            }
            next();
        }




        app.get('/appointmentoptions',async(req,res)=>{
            const date=req.query.date;
            //console.log(date)
            const query={};
            const options=await appointmentOptionCollection.find(query).toArray();
            const bookingQuery={ appointmentDate:date}
            const alredyBooked= await bookingsCollection.find(bookingQuery).toArray();
            options.forEach(option=>{
                const optionBooked=alredyBooked.filter(book=>book.treatment===option.name);
                const bookedSlots=optionBooked.map(book=>book.slot)
                const reamingSlots=option.slots.filter(slot=>!bookedSlots.includes(slot))
                option.slots=reamingSlots
            })
            res.send(options)

        })

          //for doctor speciality
          app.get('/appointmentSpecialty',async(req,res)=>{
            const query={};
            const result=await appointmentOptionCollection.find(query).project({name:1}).toArray();
            res.send(result);
          })



        app.get('/bookings',verifyJWT,async(req,res)=>{

            const email=req.query.email;
            const query={email:email};
            const decodedEmail=req.decoded.email;
            if(email!=decodedEmail){
                return res.status(403).send({message:'fobidden'})
            }
            const bookings=await bookingsCollection.find(query).toArray();
            res.send(bookings);
        })
        app.post('/bookings',async(req,res)=>{
            const booking=req.body
            // console.log(booking);
            const query={
                appointmentDate:booking.appointmentDate,
                treatment:booking.treatment,
                email:booking.email
            }
            const alredyBooked = await bookingsCollection.find(query).toArray();
            if(alredyBooked.length){
                const message=`You already a booing on ${booking.appointmentDate}`
                return res.send({acknowledged:false,message})
            }
            const result=await  bookingsCollection.insertOne(booking)
            res.send(result);
        });

        //for payment
        app.post('/create-payment-intent',async(req,res)=>{
            const booking=req.body;
            const price=booking.price;
            const amount=price * 100;
            const paymentIntent = await stripe.paymentIntents.create({
                amount:amount,
                currency: "usd",
               "payment_method_types": [
                  "card"
               ]
              });
              res.send({
                clientSecret: paymentIntent.client_secret,
              });
            
        });

        // store payment data in database
        app.post('/payments',async(req,res)=>{

            const payment=req.body;
            const result= await paymentCollection.insertOne(payment);
            const id=payment.bookingId
            const filter={_id:ObjectId(id)}
            const updateDoc={
                $set:{
                    paid:true,
                    transactionId:payment.transactionId
                }
            }
            const updateResult= await bookingsCollection.updateOne(filter,updateDoc)
            res.send(result);
        });

        //get uniqe dtails from bookings
        app.get('/bookings/:id',async(req,res)=>{

            const id=req.params.id;
            const query={_id:ObjectId(id)};
            const booking=await bookingsCollection.findOne(query);
            res.send(booking);


        })

        app.get('/jwt', async (req, res) => {
            const email = req.query.email;
            const query = { email: email };
            const user = await usersCollection.findOne(query);
            if (user) {
                const token = jwt.sign({ email }, process.env.ACCESS_TOKEN, { expiresIn: '1h' })
                return res.send({ accessToken: token });
            }
            res.status(403).send({ accessToken: '' })
        });

        app.get('/users',async(req,res)=>{
            const query={};
            const users= await usersCollection.find(query).toArray();
            res.send(users);
        });
        app.get('/users/admin/:email',async(req,res)=>{
           const email=req.params.email;
            const query={email};
            const user=await usersCollection.findOne(query);
            res.send({isAdmin:user?.role ==='admin'});
        })

        //post users

        app.post('/users',async(req,res)=>{
            const user=req.body;
            console.log(user)
            const result=await usersCollection.insertOne(user);
            res.send(result);
        });
        app.put('/users/admin/:id',verifyJWT,verifyAdmin, async(req,res)=>{

            // const decodedEmail=req.decoded.email;
            // const query={email:decodedEmail};
            // user=await usersCollection.findOne(query)
            // if(user?.role!=='admin'){
            //     res.status(403).send({message:'forbidden'})
            // }
            const id=req.params.id;
            const filter={_id:ObjectId(id)};
            const options={upsert:true};
            const updateDoc={
                $set:{
                    role:'admin'
                }
            }
            const result=await usersCollection.updateOne(filter,updateDoc,options);
            res.send(result);


        });
        //temporary to update price field on appointment option
        // app.get('/addPrice',async(req,res)=>{

        //     const filter={};
        //     const option={upsert:true};
        //     const updateDoc={
        //         $set:{
        //            price:99
        //         }
        //     }
        //     const result= await appointmentOptionCollection.updateMany(filter,updateDoc,option);
        //     res.send(result);


        // });

         app.get('/doctors',async(req,res)=>{
            const query={};
            const result= await doctorsCollection.find(query).toArray();
            res.send(result)
         })
        //for doctorCollection
        app.post('/doctors',async(req,res)=>{
            const doctor=req.body;
            const result= await doctorsCollection.insertOne(doctor);
           res.send(result);
        });
        //delet doctor.
        app.delete('/doctors/:id',async(req,res)=>{
          
            const id=req.params.id;
            const filter={_id:ObjectId(id)}
            const result=  await doctorsCollection.deleteOne(filter);
            res.send(result);
        })
    }
    finally{

    }

}

run().catch(err=>console.log(err))














app.get('/', async(req,res)=>{

  res.send("docyor running..");
})

app.listen(port,()=>{
    console.log(port)
});
