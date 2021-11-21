import mongoose from "mongoose";
import crypto from "crypto";
import Block from "./Block.js";
import Transaction from "./Transaction.js";
import User from "./User.js";
import Miner from "./Miner.js";

const { ObjectId } = mongoose.Schema;
const difficulty = process.env.MINING_DIFFICULTY || 3;
const godName = process.env.GOD_NAME || 'god';
const godEmail = process.env.GOD_EMAIL || 'god@example.com';
const godPassword = process.env.GOD_PASSWORD || 'adminPassword';

const BlockchainSchema = mongoose.Schema({
    difficulty: {
        type: Number,
        default: difficulty
    },
    chain: [{
        type: ObjectId, ref: 'Block'
    }],
    pendingTransactions: [{
        type: ObjectId, ref: 'Transaction'
    }],
    miningReward: {
        type: Number,
        default: 100
    }
}, {
    timestamps: true,
    toJSON: { versionKey: false },
    toObject: { versionKey: false }
});

BlockchainSchema.methods = {

    async addBlock(blockInfo) {
        const newBlock = await Block.create(blockInfo);
        this.chain.push(newBlock);
    },

    async getLatestBlock() {
        const blockId = this.chain[this.chain.length-1];
        const block = await Block.findById(blockId);
        return block;
    },

    getBlock(index) { 
        if (index >= this.chain.length) {
            throw new Error(`Out of Bounds Error: There is no block with index ${index} on this chain.`);
        }
        return this.chain[index]; 
    },

    getChain() { return this.chain; },

    async getCurrentHash() {
        const latestBlock = await this.getLatestBlock();
        return latestBlock.getHash();
    },

    async getMiningInfo() {
        
        // get hash of current block (will be "previous hash" for next):
        const previousHash = await this.getCurrentHash();

        // get basic transxn info for pending transactions:
        const transactions = await Promise.all(this.pendingTransactions.map(async t => {
            const transaction = await Transaction.findById(t);
            return transaction.basicInfo();
        }));

        return {
            previousHash,
            transactions,
            difficulty: this.difficulty 
        };
    },

    async checkSolution(solutionPkg) {
        const { solution, transactions, nonce, minedBy, timestamp, previousHash } = solutionPkg;

        // validate previouHash:
        const currentHash = await this.getCurrentHash();
        if (currentHash !== previousHash) return false;

        // make sure at least one transaction included
        if (transactions.length === 0) return false;

        // make sure all transactions still remain in pending transactions:
        for (const t of transactions) {
            console.log("t:", t);
            if (!this.pendingTransactions.includes(t._id)) {
                console.log(`transaction ${t._id} not in pending transactions.`);
                return false;
            }
        }

        // validate that the hash is accurate:
        const rebuiltHash = crypto.createHash('sha256').update(previousHash + timestamp +
            JSON.stringify(transactions) + nonce).digest('hex');

        return solution === rebuiltHash;
    },

    async addBlock(solutionPkg) {
        const { solution, transactions, nonce, minedBy, timestamp, previousHash } = solutionPkg;

        for (const t of transactions) {
            let transactionIndex;
            if ((transactionIndex = this.pendingTransactions.indexOf(t._id)) > -1) {
                console.log(`Removing ${t._id} at position ${transactionIndex}`);
                this.pendingTransactions.splice(transactionIndex, 1);
            }
        }
        
        let block = await Block.create({ previousHash, transactions, nonce, minedBy });
        this.chain.push(block);

        await this.save();
    },


    minePendingTransactions(miner) {
        let block = new Block(this.pendingTransactions, this.getLatestBlock().hash);
        block.mineBlock(this.difficulty, miner);
        
        this.chain.push(block);
        const transaction = new Transaction(null, miner, this.miningReward);
        this.pendingTransactions = [transaction];
        return transaction;
    },

    async addTransaction(transaction) {
        this.pendingTransactions.push(transaction);
        await this.save();
    },

    getBalance(address) {
        let balance = 0.0;
        for(const block of this.chain) {
            for (const transxn of block.transactions) {
                if (transxn.to === address) {
                    balance += transxn.amount;
                }
                if (transxn.from === address) {
                    balance -= transxn.amount;
                }
            }
        }

        return balance;
    },

    isChainValid() {
        for (let i=1; i < this.chain.length; i++) {
            const currentBlock = this.chain[i];

            console.log("block", i, "transactions valid:", this.chain[i].transactionsValid());
            if (!this.chain[i].transactionsValid()) {
                console.log("Transactions not valid for block", i);
                return false;
            }

            if (this.chain[i].hash != this.chain[i].calculateHash()) {
                console.log("Hash isn't valid for block", i);
                return false;
            };

            if (this.chain[i].previousHash != this.chain[i-1].hash) {
                console.log("PRevious hash of block", i, "doesn't match previous block's hash.");
                return false;
            } 
        }
        return true;
    }
}


BlockchainSchema.statics = {
    async getBlockchain() {
        let bc = await this.findOne().sort({ updated: -1}).limit(1);
        if (!bc) {
            bc = await this.create({});
            this.createGenesisBlock(bc._id);
        }

        return bc;
    },

    async createGenesisBlock(id) {
        const god = await User.create({
            name: godName,
            email: godEmail,
            password: godPassword,
            role: 'admin'
        });

        console.log('god created');
        const previousHash = crypto.createHash('sha256').update(Date.now().toString()).digest('hex');

        const genesisBlock = await Block.create({previousHash, nonce: 0, minedBy: god.wallet()});

        this.updateOne(
            { _id: id },
            { $push: 
                { chain: genesisBlock } 
            }, () => {
                console.log("block added to chain:", genesisBlock)
            }
        );
    }
}

export default mongoose.model('Blockchain', BlockchainSchema);