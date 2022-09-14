import { Wallet, BigNumberish } from 'ethers'
import { Create2Factory } from '../../src/Create2Factory'
import { ethers } from 'hardhat'
import { expect } from 'chai'
import {
  SmartWallet,
  SmartWallet__factory,
  DefaultCallbackHandler,
  DefaultCallbackHandler__factory,
  EntryPoint,
  VerifyingPayMaster,
  VerifyingPayMaster__factory,
  VerifyingPayMasterFactory,
  VerifyingPayMasterFactory__factory,
  WalletFactory,
  WalletFactory__factory,
  EntryPoint__factory
} from '../../typechain'
import {
  AddressZero,
} from './testutils'
import { fillAndSign } from './UserOp'
import { arrayify, hexConcat, parseEther } from 'ethers/lib/utils'

export async function deployEntryPoint (paymasterStake: BigNumberish, unstakeDelaySecs: BigNumberish, provider = ethers.provider): Promise<EntryPoint> {
  const create2factory = new Create2Factory(provider)
  const epf = new EntryPoint__factory(provider.getSigner())
  const ctrParams = ethers.utils.defaultAbiCoder.encode(['uint256', 'uint256'],
    [paymasterStake, unstakeDelaySecs])

  const addr = await create2factory.deploy(hexConcat([epf.bytecode, ctrParams]), 0)
  return EntryPoint__factory.connect(addr, provider.getSigner())
}

describe('EntryPoint with VerifyingPaymaster', function () {
  let entryPoint: EntryPoint
  let entryPointStatic: EntryPoint
  let walletOwner
  let proxyPayMaster
  let walletAddress, payMasterAddress
  let ethersSigner
  console.log('ethersSigner ', ethersSigner);
  
  let offchainSigner, deployer

  let verifyPayMasterImp: VerifyingPayMaster
  let verifyPayMasterFactory: VerifyingPayMasterFactory
  let smartWalletImp: SmartWallet
  let walletFactory: WalletFactory
  let callBackHandler: DefaultCallbackHandler

  before(async function () {
    ethersSigner = await ethers.getSigners()
    entryPoint = await deployEntryPoint(1, 1)
    entryPointStatic = entryPoint.connect(AddressZero)

    deployer = ethersSigner[0]
    offchainSigner = ethersSigner[1]
    walletOwner = ethersSigner[2]

    console.log('walletOwner ', walletOwner.address);
    

    verifyPayMasterImp = await new VerifyingPayMaster__factory(deployer).deploy()


    verifyPayMasterFactory = await new VerifyingPayMasterFactory__factory(deployer).deploy(verifyPayMasterImp.address)

    let deployPayMasterTrx = await verifyPayMasterFactory.deployVerifyingPayMaster(walletOwner.address, offchainSigner.address, entryPoint.address)
    deployPayMasterTrx = await deployPayMasterTrx.wait()
    payMasterAddress = deployPayMasterTrx?.events[1]?.args[0]
    console.log(' payMasterAddress ', payMasterAddress);
    


    smartWalletImp = await new SmartWallet__factory(deployer).deploy()


    walletFactory = await new WalletFactory__factory(deployer).deploy(smartWalletImp.address)
    
    callBackHandler = await new DefaultCallbackHandler__factory(deployer).deploy()
    
    
    let walletDeploymentTrx = await walletFactory.deployCounterFactualWallet(walletOwner.address, entryPoint.address, callBackHandler.address, 0)
    walletDeploymentTrx = await walletDeploymentTrx.wait()
    walletAddress = walletDeploymentTrx.events[0]?.args[0]
    console.log(' walletDeploymentTrx ', walletAddress);
    

    proxyPayMaster = new ethers.Contract(payMasterAddress, verifyPayMasterImp.interface, walletOwner)
    await proxyPayMaster.addStake(0, { value: parseEther('2') })
    await entryPoint.depositTo(payMasterAddress, { value: parseEther('1') })
    const resultSet = await entryPoint.getDepositInfo(payMasterAddress)
    console.log('deposited state ', resultSet);

  })

  describe('#validatePaymasterUserOp', () => {
    it('should reject on no signature', async () => {
      const userOp = await fillAndSign({
        sender: walletAddress,
        paymasterAndData: hexConcat([payMasterAddress, '0x1234'])
      }, walletOwner, entryPoint)
      await expect(entryPointStatic.callStatic.simulateValidation(userOp, false)).to.be.revertedWith('invalid signature length in paymasterAndData')
    })

    it('should reject on invalid signature', async () => {
      const userOp = await fillAndSign({
        sender: walletAddress,
        paymasterAndData: hexConcat([payMasterAddress, '0x' + '1c'.repeat(65)])
      }, walletOwner, entryPoint)
      await expect(entryPointStatic.callStatic.simulateValidation(userOp, false)).to.be.revertedWith('ECDSA: invalid signature')
    })

    it('succeed with valid signature', async () => {
      const userOp1 = await fillAndSign({
        sender: walletAddress
      }, walletOwner, entryPoint)
      const hash = await proxyPayMaster.getHash(userOp1)
      const sig = await offchainSigner.signMessage(arrayify(hash))
      const userOp = await fillAndSign({
        ...userOp1,
        paymasterAndData: hexConcat([payMasterAddress, sig])
      }, walletOwner, entryPoint)
      await entryPointStatic.callStatic.simulateValidation(userOp, false)
    })
  })
})
