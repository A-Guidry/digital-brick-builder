# Brings up the loopback interface inside a new network namespace, then execs the given command.
import socket,fcntl,struct,os,sys
s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM)
fcntl.ioctl(s,0x8914,struct.pack('16sH14s',b'lo',1|0x40|0x8,b'\0'*14))  # SIOCSIFFLAGS UP|RUNNING|LOOPBACK
os.execvp(sys.argv[1],sys.argv[1:])
