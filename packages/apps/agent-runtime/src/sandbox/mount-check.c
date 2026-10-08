/* Root-only, credential-free mount attestation. Only pinned directory descriptors
 * cross the nonce-bound socket; no helper or proof descriptor reaches Pi/MCP. */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <grp.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/statfs.h>
#include <sys/statvfs.h>
#include <sys/un.h>
#include <sys/sysmacros.h>
#include <unistd.h>
#define ROOT "/Volumes/MOTHERSHIP"
#define CACHE ROOT "/.rue-colima-cache"
#define MAX 8
static void deadline(int signal_number){(void)signal_number;_exit(78);}
static void fail(void){fputs("agent_mount_verification_failed\n",stderr);exit(78);}
static void drop(void){if(getuid()!=0||setgroups(0,NULL)||setgid(1000)||setuid(1000))fail();}
static int within(const char *path,const char *root){size_t n=strlen(root);return !strncmp(path,root,n)&&(!path[n]||path[n]=='/');}
static int within_fold(const char *path,const char *root){size_t n=strlen(root);return !strncasecmp(path,root,n)&&(!path[n]||path[n]=='/');}
static int ends(const char *path,const char *suffix){size_t a=strlen(path),b=strlen(suffix);return a>=b&&!strcmp(path+a-b,suffix);}
static int contains_tree(const char *path,const char *fragment){const char *p=path;size_t n=strlen(fragment);while((p=strstr(p,fragment))){if(!p[n]||p[n]=='/')return 1;p++;}return 0;}
/* Mirrors validHostDirectory; directories cannot shadow runtime internals or
 * expose known controller state. A whole legacy volume retains its cache mask. */
static void allowed(const char *path){
 if(!path||path[0]!='/'||strlen(path)>1024||strlen(path)<2||ends(path,"/")||strstr(path,"//")||contains_tree(path,"/.")||contains_tree(path,"/.."))fail();
 for(const unsigned char *p=(const unsigned char*)path;*p;p++)if(*p<32||*p==127)fail();
 char folded[1025];size_t length=strlen(path);
 for(size_t i=0;i<=length;i++)folded[i]=path[i]>='A'&&path[i]<='Z'?(char)(path[i]+32):path[i];
 path=folded;
 const char *reserved[]={"/app","/control","/state","/workspace","/bin","/sbin","/usr","/lib","/lib64","/etc","/proc","/sys","/dev","/run","/tmp","/var/run","/var/lib/docker","/var/lib/containerd","/var/lib/rue-worker"};
 for(size_t i=0;i<sizeof(reserved)/sizeof(reserved[0]);i++)if(within(path,reserved[i])||within(reserved[i],path))fail();
 if(!strcmp(path,"/users")||!strcmp(path,"/home")||!strcmp(path,"/root")||!strcmp(path,"/volumes"))fail();
 if((!strncmp(path,"/users/",7)&&!strchr(path+7,'/'))||(!strncmp(path,"/home/",6)&&!strchr(path+6,'/')))fail();
 if(contains_tree(path,"/.colima")||contains_tree(path,"/.docker")||contains_tree(path,"/.rue-colima-cache")||contains_tree(path,"/.local/state/rue")||ends(path,"/.local")||ends(path,"/.local/state")||contains_tree(path,"/library/caches/colima")||ends(path,"/library")||ends(path,"/library/caches"))fail();
}
static int dir(const char *path){
 if(!path||path[0]!='/'||strlen(path)>1024)fail();
 int fd=open("/",O_PATH|O_DIRECTORY|O_CLOEXEC);if(fd<0)fail();
 char *copy=strdup(path+1),*part=copy;if(!copy)fail();
 while(*part){char *slash=strchr(part,'/');if(slash)*slash=0;
  if(!*part||!strcmp(part,".")||!strcmp(part,".."))fail();
  int next=openat(fd,part,O_PATH|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);close(fd);if(next<0)fail();fd=next;
  if(!slash)break;
  part=slash+1;if(!*part)fail();
 }
 free(copy);return fd;
}
#ifndef RUE_MOUNT_TEST
/* A root bind hides source symlinks. Require an actual daemon-host virtiofs
 * mountpoint, and the same filesystem root/device in the helper. This rejects
 * aliases and subdirectories masquerading as operator-approved share roots. */
static int mount_path_equal(const char *encoded,const char *path){
 char decoded[1025];size_t n=0;
 while(*encoded){
  if(n>=1024)return 0;
  if(*encoded=='\\'){
   if(strlen(encoded)<4||encoded[1]<'0'||encoded[1]>'7'||encoded[2]<'0'||encoded[2]>'7'||encoded[3]<'0'||encoded[3]>'7')return 0;
   int value=(encoded[1]-'0')*64+(encoded[2]-'0')*8+encoded[3]-'0';
   if(value!=32&&value!=9&&value!=10&&value!=92)return 0;
   decoded[n++]=(char)value;encoded+=4;
  }else decoded[n++]=*encoded++;
 }
 decoded[n]=0;return !strcmp(decoded,path);
}
static void anchor(const char *file,const char *path,const struct stat *st){
 FILE *stream=fopen(file,"r");if(!stream)fail();
 char line[16384];size_t total=0;int found=0;
 while(fgets(line,sizeof(line),stream)){
  total+=strlen(line);if(total>1048576||!strchr(line,'\n'))fail();
  char *cursor=NULL,*fields[6];
  fields[0]=strtok_r(line," ",&cursor);
  for(int i=1;i<6;i++)fields[i]=strtok_r(NULL," ",&cursor);
  if(!fields[5]||!mount_path_equal(fields[4],path))continue;
  unsigned int a,b;char extra;
  if(sscanf(fields[2],"%u:%u%c",&a,&b,&extra)!=2||a!=major(st->st_dev)||b!=minor(st->st_dev)||strcmp(fields[3],"/"))fail();
  char *token;do{token=strtok_r(NULL," ",&cursor);}while(token&&strcmp(token,"-"));
  token=strtok_r(NULL," ",&cursor);
  if(!token||strcmp(token,"virtiofs"))fail();
  found++;
 }
 if(ferror(stream)||found!=1)fail();
 fclose(stream);
}
#endif
struct proof{char nonce[37];uint32_t count;};
int main(int argc,char **argv){
 if(argc<5||strlen(argv[2])!=36)fail();
 for(int i=0;i<36;i++)if(!((argv[2][i]>='0'&&argv[2][i]<='9')||(argv[2][i]>='a'&&argv[2][i]<='f')||argv[2][i]=='-'))fail();
 int extended=!strcmp(argv[1],"serve-v3")||!strcmp(argv[1],"verify-v3");
 int serve=!strcmp(argv[1],"serve")||!strcmp(argv[1],"serve-v3");
 if(!serve&&strcmp(argv[1],"verify")&&strcmp(argv[1],"verify-v3"))fail();
 const char *roots[MAX]={ROOT};int root_count=1,start=3;
 if(extended){
  if(strlen(argv[3])!=1||argv[3][0]<'1'||argv[3][0]>'8')fail();
  root_count=argv[3][0]-'0';start=4+root_count;if(argc<start+2)fail();
  for(int i=0;i<root_count;i++){roots[i]=argv[4+i];allowed(roots[i]);}
  for(int i=0;i<root_count;i++)for(int j=0;j<root_count;j++)if(i!=j&&within_fold(roots[i],roots[j]))fail();
 }
 if((argc-start)%2||(argc-start)/2<1||(argc-start)/2>MAX)fail();
 int count=(argc-start)/2,masked=0,selected[MAX];
 for(int i=0;i<count;i++){
  const char *access_mode=argv[start+2*i],*path=argv[start+2*i+1];
  if(strcmp(access_mode,"read")&&strcmp(access_mode,"write"))fail();
  allowed(path);selected[i]=-1;
  for(int j=0;j<root_count;j++)if(within(path,roots[j]))selected[i]=j;
  if(selected[i]<0)fail();
  if(!strcmp(path,ROOT))masked=1;
  for(int j=0;j<i;j++)if(!strcasecmp(path,argv[start+2*j+1]))fail();
 }
 for(int i=0;i<count;i++)for(int j=0;j<count;j++)if(i!=j&&!strcmp(argv[start+2*i],"read")&&!strcmp(argv[start+2*j],"write")&&within_fold(argv[start+2*i+1],argv[start+2*j+1]))fail();
 signal(SIGALRM,deadline);alarm(40);umask(0077);
 int sock=socket(AF_UNIX,SOCK_SEQPACKET|SOCK_CLOEXEC,0);if(sock<0)fail();
 struct sockaddr_un address={.sun_family=AF_UNIX};
 if(snprintf(address.sun_path,sizeof(address.sun_path),"/control/workspace-%s.sock",argv[2])>=(int)sizeof(address.sun_path))fail();
 int fds[MAX];struct proof proof;memset(&proof,0,sizeof(proof));proof.count=(uint32_t)count;memcpy(proof.nonce,argv[2],37);
 union{struct cmsghdr alignment;char bytes[CMSG_SPACE(sizeof(fds))];} ancillary;
 memset(&ancillary,0,sizeof(ancillary));struct iovec io={.iov_base=&proof,.iov_len=sizeof(proof)};
 struct msghdr message={.msg_iov=&io,.msg_iovlen=1,.msg_control=ancillary.bytes,.msg_controllen=sizeof(ancillary.bytes)};
 if(serve){
  if(bind(sock,(struct sockaddr*)&address,sizeof(address))||listen(sock,1))fail();
  drop();struct stat rootstat[MAX];
  for(int i=0;i<root_count;i++){
   int root=dir(roots[i]);struct statfs fs;
   if(fstatfs(root,&fs)||fstat(root,&rootstat[i]))fail();
#ifndef RUE_MOUNT_TEST
   /* A prepared host share, never an accidentally created VM-local directory. */
   if((unsigned long)fs.f_type!=0x65735546UL)fail();
   if(extended){anchor("/app/host-mountinfo",roots[i],&rootstat[i]);anchor("/proc/self/mountinfo",roots[i],&rootstat[i]);}
#endif
   close(root);
  }
  if(masked){int cache=dir(CACHE);close(cache);}
  struct stat sources[MAX];
  for(int i=0;i<count;i++){
   fds[i]=dir(argv[start+2*i+1]);if(fstat(fds[i],&sources[i])||sources[i].st_dev!=rootstat[selected[i]].st_dev)fail();
   for(int j=0;j<i;j++)if(sources[i].st_dev==sources[j].st_dev&&sources[i].st_ino==sources[j].st_ino)fail();
  }
  /* Names can alias on host filesystems. Check actual ancestry as well. */
  for(int i=0;i<count;i++)if(!strcmp(argv[start+2*i],"read")){
   int current=dup(fds[i]),reached=0;if(current<0)fail();
   for(int depth=0;depth<1024;depth++){
    struct stat st;if(fstat(current,&st)||st.st_dev!=rootstat[selected[i]].st_dev)fail();
    for(int j=0;j<count;j++)if(!strcmp(argv[start+2*j],"write")&&st.st_dev==sources[j].st_dev&&st.st_ino==sources[j].st_ino)fail();
    if(st.st_ino==rootstat[selected[i]].st_ino){reached=1;break;}
    int parent=openat(current,"..",O_PATH|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);close(current);if(parent<0)fail();current=parent;
   }
   close(current);if(!reached)fail();
  }
  puts("mount_probe_ready");fflush(stdout);
  int client=accept4(sock,NULL,NULL,SOCK_CLOEXEC);if(client<0)fail();
  struct ucred peer;socklen_t size=sizeof(peer);if(getsockopt(client,SOL_SOCKET,SO_PEERCRED,&peer,&size)||peer.uid!=0)fail();
  message.msg_controllen=CMSG_SPACE(sizeof(int)*count);struct cmsghdr *control=CMSG_FIRSTHDR(&message);
  control->cmsg_level=SOL_SOCKET;control->cmsg_type=SCM_RIGHTS;control->cmsg_len=CMSG_LEN(sizeof(int)*count);
  memcpy(CMSG_DATA(control),fds,sizeof(int)*count);
  if(sendmsg(client,&message,MSG_NOSIGNAL)!=(ssize_t)sizeof(proof))fail();
  close(client);close(sock);for(int i=0;i<count;i++)close(fds[i]);return 0;
 }
 int connected=0;
 for(int i=0;i<50;i++){if(!connect(sock,(struct sockaddr*)&address,sizeof(address))){connected=1;break;}if(errno!=ENOENT&&errno!=ECONNREFUSED)fail();usleep(100000);}
 if(!connected)fail();
 struct proof received={0};io.iov_base=&received;
 if(recvmsg(sock,&message,MSG_CMSG_CLOEXEC)!=(ssize_t)sizeof(received)||(message.msg_flags&(MSG_CTRUNC|MSG_TRUNC))||received.count!=(uint32_t)count||memcmp(received.nonce,proof.nonce,37))fail();
 struct cmsghdr *control=CMSG_FIRSTHDR(&message);
 if(!control||control->cmsg_level!=SOL_SOCKET||control->cmsg_type!=SCM_RIGHTS||control->cmsg_len!=CMSG_LEN(sizeof(int)*count)||CMSG_NXTHDR(&message,control))fail();
 memcpy(fds,CMSG_DATA(control),sizeof(int)*count);close(sock);drop();
 if(masked){
  int cache=dir(CACHE);struct statfs fs;struct stat st;struct statvfs mount;
  if(fstatfs(cache,&fs)||fstat(cache,&st)||fstatvfs(cache,&mount)||(unsigned long)fs.f_type!=0x01021994UL||!(mount.f_flag&ST_RDONLY)||(st.st_mode&0777))fail();
  struct stat alias;
  if(!lstat(ROOT "/.RUE-COLIMA-CACHE",&alias)){
   if(alias.st_dev!=st.st_dev||alias.st_ino!=st.st_ino)fail();
  }else if(errno!=ENOENT)fail();
  close(cache);
 }
 for(int i=0;i<count;i++){
  int actual=dir(argv[start+2*i+1]);struct stat expected,observed;struct statvfs mount;
  if(fstat(fds[i],&expected)||fstat(actual,&observed)||fstatvfs(actual,&mount)||expected.st_dev!=observed.st_dev||expected.st_ino!=observed.st_ino)fail();
  int write=!strcmp(argv[start+2*i],"write");
  if((!!(mount.f_flag&ST_RDONLY))==write||access(argv[start+2*i+1],R_OK|X_OK|(write?W_OK:0)))fail();
  close(actual);close(fds[i]);
 }
 puts("agent_mounts_verified");return 0;
}
